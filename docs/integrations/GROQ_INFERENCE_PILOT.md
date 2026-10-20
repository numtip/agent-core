# Groq inference pilot (local / optional)

**Status:** IMPLEMENTED on branch `feat/groq-inference-pilot` · **VPS activation BLOCKED** (ADR [0001](../adr/0001-groq-inference-pilot.md))

## Scope

- **Jev / OpenRouter Decisions** (`/v1/decision`, `/v1/route`, `/v1/qa`) — unchanged; still `~typesafe/jev-latest` via OpenRouter alpha Decisions API.
- **Optional Groq chat** — OpenAI-compatible `/chat/completions` at `POST /v2/inference/complete` with scope `inference`.
- **Default model:** `openai/gpt-oss-120b` (Groq may populate `reasoning`; provider maps it when `content` is empty)
- **Budget:** `GROQ_MONTHLY_BUDGET_USD` (default **$10**), ledger at `GROQ_COST_LEDGER`
- **Resilience:** timeout, retry (429/5xx), fallback to OpenRouter chat when Groq fails (`GROQ_FALLBACK_OPENROUTER=true`)
- **Audit:** `INFERENCE_COMPLETE` rows in `AGENT_CORE_AUDIT_LOG` (no secrets; token counts + estimated cost only)

## Configuration

See [`.env.example`](../../.env.example). Secrets stay in `.env` only.

| Variable | Purpose |
|----------|---------|
| `GROQ_ENABLED` | Must be `true` for Groq calls even when `GROQ_API_KEY` is set (fail-safe default in `.env.example`) |
| `GROQ_MODEL` | Default `openai/gpt-oss-120b` |
| `GROQ_MONTHLY_BUDGET_USD` | Hard monthly guard (estimated from usage × rates) |
| `GROQ_FALLBACK_OPENROUTER` | Chat fallback via `OPENROUTER_CHAT_*` |

## API

### `GET /v2/inference/budget`

Scope: `inference`. Returns month spend, remaining budget, token totals.

### `POST /v2/inference/complete`

```json
{
  "project": "agent-core",
  "task_id": "optional-id",
  "messages": [{ "role": "user", "content": "..." }],
  "max_tokens": 256,
  "provider_preference": "auto"
}
```

## Benchmark (3 tasks)

With local Agent Core running:

```bash
npm run build && node dist/src/server.js
# separate shell — set AGENT_PROJECT_TOKEN with inference scope
node --env-file=.env ops/groq-benchmark.mjs
```

## Capability registry

`model.groq` — PLANNED pilot metadata pointing at `/v2/inference/complete`.

## Labels

| Label | State |
|-------|--------|
| IMPLEMENTED | Branch code + unit tests |
| DEPLOYED | No |
| ACTIVATED | Local `.env` only (operator) |
| VERIFIED | Local `npm test` + optional live benchmark |
