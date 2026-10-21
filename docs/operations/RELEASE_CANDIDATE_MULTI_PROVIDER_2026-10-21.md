# Release candidate — multi-provider inference routing (2026-10-21)

**RC:** `rc-2026.10.21-multiprovider` · **Commit:** `5ae20af0fe86a5974d95844aa9b706d464f61f8e`
**Status:** DEPLOYED to production `:8787` as **code parity** on 2026-10-21 17:59 +07 (owner-approved). Inference stays **blocked** in production: no project holds the `inference` scope and the ADR 0001 pilot guard still refuses the routes.

Source chain: PR [#41](https://github.com/numtip/agent-core/pull/41) (`5e1bceb`, multi-provider routing) → PR [#43](https://github.com/numtip/agent-core/pull/43) (`5ae20af`, shared breaker state) → this document.

## What the candidate contains

| Area | Change |
|---|---|
| Routing | `TASK_ROUTE` / `MODEL_ROUTE` in `src/inference/routing.ts` (ADR [0003](../adr/0003-multi-provider-inference-routing.md)) |
| Providers | Groq (fast), DeepSeek (reasoning, OpenAI-compatible, `reasoning_content` fallback), OpenRouter (policy-gated frontier tier) |
| Resilience | per-provider circuit breaker, retries on 429/5xx, request timeouts |
| Policy | frontier tier needs `INFERENCE_FRONTIER_ENABLED=1`, never in `production`, fail-closed `403 INFERENCE_FRONTIER_BLOCKED`, no silent downgrade |
| Budget | shared monthly ledger; reservation = worst case across the planned chain |
| Contract | `POST /v2/inference/complete` accepts optional `task`; responses add `task` + `route` |
| Unchanged | Jev Decisions on `/v1/decision`, `/v1/route`, `/v1/qa`; pilot guard (production always blocked); auth, scopes, SSRF/browser guards |


## Deployment log — 2026-10-21 17:59 +07 (executed, owner-approved)

| Item | Value |
|---|---|
| Release directory | `~/agent-core/releases/5ae20af` (`RELEASE_SHA=5ae20af…`, built with `npm ci` + `npm run build`, `npm test` 268 passed / 3 skipped) |
| Cutover | `current` symlink swapped atomically (`ln -sfn` + `mv -T`) → `releases/5ae20af`, then `systemctl --user restart agent-core.service` |
| Previous release | `releases/dbe20a5` (kept on disk, rollback target) |
| Service | `active`, MainPID `3130339` (was `2891042`), `GET /v1/health` → 200 including the new routing capability fields |
| Auth surface | unauthenticated `/v2/inference/complete` → **401**; `/v1/decision` unauthenticated → **401**; no project holds the `inference` scope, so inference stays unreachable for clients |
| Env changes | `~/.config/agent-core/agent-core.env` (mode 600, backup `agent-core.env.bak-multiprovider-20261021-175937`): `DEEPSEEK_*` (key stored host-only, never in git or chat), `DEEPSEEK_ENABLED=false`, `OPENROUTER_FRONTIER_MODEL=deepseek/deepseek-v4-flash`, `INFERENCE_FRONTIER_ENABLED=false`, `INFERENCE_CIRCUIT_*`, `GROQ_TIMEOUT_MS=25000` |
| Staging `:8788` | not modified, still `releases/41195f6`, health 200 |

**Artifact proof (isolated dev instance `:8789` from the same release, stopped afterwards, temp env deleted):**

| Case | Route | Provider / model | Latency | Cost |
|---|---|---|---|---|
| `task=fast` | `[groq, deepseek, openrouter]` | deepseek `deepseek-flash` (fallback after a Groq cold-start timeout) | 21 016 ms | $0.0000237 |
| `task=reasoning` | `[deepseek, groq, openrouter]` | deepseek `deepseek-v4-pro` | 999 ms | $0.0000377 |
| `task=frontier` | `[openrouter, deepseek, groq]` | openrouter `deepseek/deepseek-v4-flash` | 1 653 ms | $0.0000048 |

Ledger for that smoke: 3 requests, **$0.00006612**. Finding: Groq's first call after idle took **15.4 s** (subsequent 0.33–0.54 s) — that is why `GROQ_TIMEOUT_MS` was raised to 25 s; the fallback it caused was a timeout, not a provider error.

**Rollback (not needed, verified mechanically):** `ln -sfn ~/agent-core/releases/dbe20a5 ~/agent-core/current.new && mv -T ~/agent-core/current.new ~/agent-core/current && systemctl --user restart agent-core.service`, then `GET /v1/health`.

## Deployment procedure (for the next activation)

1. Get approval for the production window. This RC touches server code only; no schema, no credential rotation, no Cloudflare change.
2. Build a new release directory from `5e1bceb` next to `~/agent-core/releases/` (do **not** reuse `dbe20a5` or `41195f6`).
3. Add to the target env file, only for a non-production activation:
   `DEEPSEEK_ENABLED`, `DEEPSEEK_API_KEY` (placed on the host, never in chat/git), `DEEPSEEK_MODEL=deepseek-flash`, `DEEPSEEK_REASONING_MODEL=deepseek-v4-pro`,
   `INFERENCE_FRONTIER_ENABLED=false`, `INFERENCE_CIRCUIT_FAILURE_THRESHOLD=3`, `INFERENCE_CIRCUIT_COOLDOWN_MS=30000`.
   Keep `GROQ_PILOT_ACTIVATION=dev-only` and `AGENT_CORE_ENV=production` on `:8787` — the inference routes stay 404 there by design.
4. Verify: `GET /v1/health` (`version 0.7.0`), `GET /v2/inference/budget` with the `inference` scope (should report `deepseek_enabled`, `frontier_escalation`, `circuit_breakers`), then one `task=fast` and one `task=reasoning` call.
5. Confirm ledger: `spent_usd` grows, `overspend_blocked: false`.

## Rollback plan

- **Fast:** repoint `~/agent-core/current` to `~/agent-core/releases/dbe20a5` and restart `agent-core.service`; `/v2/inference/*` returns 404 again. Verify `/v1/health`.
- **Scoped:** set `GROQ_ENABLED=false` + `DEEPSEEK_ENABLED=false` and restart — the offline route answers `503 INFERENCE_UNAVAILABLE` while decisions keep working.
- **Policy only:** set `INFERENCE_FRONTIER_ENABLED=false` and restart — the frontier tier disappears; fast/reasoning chains stay.
- Previous release directories (`dbe20a5`, `01092e2`, `41195f6`, `4246c0a`) are still on disk; see [V2_ROLLBACK_RUNBOOK.md](../V2_ROLLBACK_RUNBOOK.md).

## QA evidence

| Gate | Result |
|---|---|
| CI (GitHub Actions, PR #41) | `test` job **pass** (npm audit, npm test, npm run build) |
| Unit / integration | **266 passed, 3 skipped** (live tests are opt-in) — 16 new routing/breaker/policy cases |
| Build | `tsc -p tsconfig.json` clean |
| Dependency security | `npm audit --omit=dev --audit-level=high` → **0 vulnerabilities** |
| Secret scan of the diff | no keys, `.env` untracked |
| Live multi-provider (real credentials) | `LIVE_MULTI_PROVIDER_INFERENCE=1` integration test passed: fast→groq, reasoning→deepseek |
| Benchmark | [evidence/INFERENCE_MULTI_PROVIDER_BENCH_2026-10-21.json](../evidence/INFERENCE_MULTI_PROVIDER_BENCH_2026-10-21.json) — fast→groq p50 368 ms / $0.000062; reasoning→deepseek-v4-pro p50 2808 ms / $0.0000785; frontier→openrouter live 3478 ms / $0.0000638; total spend $0.0011 of the $10 cap |
| Fail-closed checks | `task=frontier` with policy off → `InferenceFrontierBlockedError` (no upstream call); frontier without an OpenRouter key → refused |
| Merged `main` re-verified | `5e1bceb`: build clean, 266 passed, 0 vulnerabilities |
| Production untouched | `:8787` still release `dbe20a5`, MainPID unchanged since 2026-10-12, `/v2/inference/*` → 404; staging `:8788` still `41195f6` |

## Known limits / follow-ups

- Circuit-breaker state and the budget ledger are in-process / per-instance — not safe for multi-instance deployment (same limitation as ADR 0001).
- The frontier tier only becomes a true capability when `OPENROUTER_FRONTIER_MODEL` names a frontier model; the default reuses the chat model.
- `task=reasoning` is ~7× slower than `task=fast`; keep `fast` on interactive paths.
- Remote branch `feat/multi-provider-inference` may still exist on GitHub after the squash merge; safe to delete.
