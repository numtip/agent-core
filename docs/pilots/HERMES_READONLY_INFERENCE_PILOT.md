# Hermes read-only pilot (Groq inference companion)

**Status:** READY (dev-only) · VPS inference **BLOCKED** per ADR 0001

## Goal

Use Hermes **read-only** memory (`hermes_memory` action `read`, `hermes_session_search`) to supply context for local Groq inference benchmarks—without granting write paths or production deploy.

## Allowed (pilot)

| Surface | Mode |
|---------|------|
| Hermes MCP `hermes_memory` | `read` / `search` only |
| Hermes MCP `hermes_session_search` | query + read sessions |
| Agent Core `knowledge.memory-store` | READ / HANDOFF / CONTEXT_ONLY |
| Agent Core `/v2/inference/complete` | scope `inference`, local dev |

## Forbidden (pilot)

- `hermes_memory` write actions (`add`, `replace`, `remove`)
- VPS / Cloudflare / production restart
- Storing API keys in Hermes memory or git-tracked docs
- Using Groq inference output as automatic execution authority

## Suggested workflow

1. Worker calls Hermes read-only tools to gather repo decisions (narrow query).
2. Context Governor / knowledge redaction runs before any model prompt (project client or `/v2/knowledge/query` handoff).
3. Optional: post summarized prompt to `/v2/inference/complete` with `task_id` for audit correlation.
4. Human reviews model output before any repo change.

## Environment checklist

- [ ] `GROQ_API_KEY` present locally (never committed)
- [ ] `AGENT_CORE_PROJECT_SCOPES` includes `inference` for `agent-core`
- [ ] `GROQ_MONTHLY_BUDGET_USD=10` (or lower for pilot)
- [ ] Hermes worker rule: no durable memory writes from Cursor workers

## Exit criteria

- 3 benchmark tasks pass under budget (`ops/groq-benchmark.mjs`)
- Audit log shows `INFERENCE_COMPLETE` without secret leakage
- Security review: no new SSRF/exec paths; scope gate enforced
