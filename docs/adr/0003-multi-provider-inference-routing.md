# ADR 0003: Multi-provider inference routing (Groq · DeepSeek · policy-gated frontier)

**Status:** Accepted · **Date:** 2026-10-21 · **Scope:** `/v2/inference/*` (ADR 0001 pilot guard still applies)

## Context

ADR 0001 shipped one chat provider (Groq) with a binary OpenRouter fallback. We need a second
tier for reasoning work (DeepSeek, OpenAI-compatible), deterministic routing instead of a
hard-coded if/else, and an escalation tier that cannot be reached without an explicit
operator decision.

Live probe on 2026-10-21 (`GET /models`, both providers): Groq offers `openai/gpt-oss-120b`;
DeepSeek offers `deepseek-flash` (fast) and `deepseek-v4-pro` (reasoning). Both return token
usage, DeepSeek also returns `reasoning_content` next to `content`.

## Decision

1. **MODEL_ROUTE** — one model per provider, resolved in `src/inference/routing.ts`:
   `groq → GROQ_MODEL`, `deepseek → DEEPSEEK_MODEL` (fast) / `DEEPSEEK_REASONING_MODEL`
   (reasoning), `openrouter → OPENROUTER_FRONTIER_MODEL` on the frontier tier,
   `OPENROUTER_CHAT_MODEL` otherwise.
2. **TASK_ROUTE** — static ordered chains, no runtime probing:
   `fast → [groq, deepseek]`, `reasoning → [deepseek, groq]`, `frontier → [openrouter, deepseek, groq]`.
   `provider_preference` moves the named provider to the front and leaves the rest intact.
3. **Frontier tier is policy-gated.** OpenRouter joins a chain only when
   `INFERENCE_FRONTIER_ENABLED=1` (and the legacy `GROQ_FALLBACK_OPENROUTER` switch is not off).
   `task=frontier` fails closed with `403 INFERENCE_FRONTIER_BLOCKED` when the policy is off,
   and the tier is **never** allowed while `AGENT_CORE_ENV=production`.
4. **Circuit breaker** (`src/inference/circuit-breaker.ts`): after
   `INFERENCE_CIRCUIT_FAILURE_THRESHOLD` consecutive failures a provider is skipped for
   `INFERENCE_CIRCUIT_COOLDOWN_MS`, then allowed one trial call. State is shared between
   processes on the same host through `<ledger>-breakers.json` under the ledger file lock;
   without a ledger path it degrades to process-local memory. A corrupt state file means
   "all closed" (availability over stale failure memory).
5. **Budget** stays shared and unchanged (ADR 0001): one monthly ledger, reserve before dispatch,
   settle or release after. The reservation is now the **worst case across the planned chain**,
   because any provider in it may serve the request.
6. **Determinism over cleverness:** policy decides the chain; the breaker only removes a
   provider; a provider that answered is recorded and priced with its own rates.

## Behaviour change

`GROQ_FALLBACK_OPENROUTER` alone no longer enables a chat fallback to OpenRouter — the frontier
policy gate must also be on. Deployments that relied on the old implicit fallback need
`INFERENCE_FRONTIER_ENABLED=1` (non-production only).

## Consequences

- No new dependency, no new service, no MCP server: DeepSeek reuses the OpenAI-compatible
  adapter already used by Groq/OpenRouter.
- `task` is optional (defaults to `fast`), so existing callers keep working; responses gained
  `task` and `route` fields.
- Budget ledger and breaker state are now shared across processes **on one host** (same file +
  `O_EXCL` lock). Multiple **hosts** sharing one ledger are still not supported.
- Frontier model is operator-chosen: `OPENROUTER_FRONTIER_MODEL=deepseek/deepseek-v4-flash`
  (2026-10-21 decision). It is a cheap tier, not a stronger model — swap the env value for a
  stronger model if escalation should buy capability rather than availability.

## Evidence (2026-10-21, local host, real credentials, ledger in a temp dir)

`docs/evidence/INFERENCE_MULTI_PROVIDER_BENCH_2026-10-21.json`, 128 completion tokens, temperature 0.

| Route | Provider / model | p50 | p95 | Cost / request |
|-------|------------------|-----|-----|----------------|
| `task=fast` (5 req) | groq `openai/gpt-oss-120b` | 368 ms | 471 ms | $0.0000620 |
| `task=reasoning` (5 req) | deepseek `deepseek-v4-pro` | 2808 ms | 7387 ms | $0.0000785 |
| `preference=groq` (3 req) | groq `openai/gpt-oss-120b` | 354 ms | 381 ms | $0.0000620 |
| `preference=deepseek` (3 req) | deepseek `deepseek-flash` | 1337 ms | 1759 ms | $0.0000510 |
| `task=frontier`, policy on | openrouter `openai/gpt-oss-120b` | 3478 ms | – | $0.0000638 |

- `task=frontier` with the policy off: `InferenceFrontierBlockedError`, no upstream call.
- `task=frontier` with the policy on but no OpenRouter key: refused (no silent downgrade).
- Total spend for the benchmark: $0.0011 against the $10 monthly cap.
- Reasoning tier is ~7× the latency of the fast tier: keep `task=fast` for interactive paths.

## Alternatives rejected

- Runtime provider probing / auto-detection: non-deterministic, harder to audit.
- One shared "model" string per request: loses the task→tier contract.
- Silent downgrade when the frontier policy blocks: hides a policy decision from the caller.
