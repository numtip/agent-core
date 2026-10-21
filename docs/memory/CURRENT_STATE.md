# Agent Core — current state

**Last updated:** 2026-10-21 22:40 +07 evening closeout  
**Status:** `PRODUCTION_5ae20af` · `STAGING_MULTIPROVIDER_LIVE` · `PRODUCTION_INFERENCE_CLOSED` · `JEV_VIA_HERMES_PASS`  
**GitHub `main` (verified before this closeout commit):** `37694cb863346ac8b470414daef10435d69ad641`  
**Live release:** `5ae20af0fe86a5974d95844aa9b706d464f61f8e`  
**Production VPS:** `current` → `releases/5ae20af` on `:8787`. Inference is **not** activated.  
**Staging VPS:** same code tree on `:8788`, separate env and ledger. Rollback tree `releases/41195f6`.

## Where to start

[2026-10-21.md](./2026-10-21.md) — today's timeline and evidence paths. [NEXT_SESSION.md](./NEXT_SESSION.md) — resume steps.

## Architecture

- **Jev / decisions:** `POST /v1/decision` on production `:8787`. Hermes skill `agent-core-jev-decision` calls that route. It does not call OpenRouter itself. Health model alias `~typesafe/jev-latest`. The decision JSON has no provider, model, or cost.
- **Inference:** `POST /v2/inference/complete` with `task` `fast` | `reasoning` | `frontier`. ADR [0001](../adr/0001-groq-inference-pilot.md) still blocks the pilot when `AGENT_CORE_ENV=production`. ADR [0003](../adr/0003-multi-provider-inference-routing.md) is live on staging only.
- **Hermes skills (host, not in this repo):**
  - `~/.hermes/skills/integrations/agent-core-jev-decision/` — production `:8787` `/v1/decision`, project `rae-attendance-v2`, scope `decision` only.
  - `~/.hermes/skills/integrations/agent-core-groq-inference/` — staging `:8788`, `--task fast|reasoning|frontier`, CONTEXT_ONLY.

## VPS surfaces (VERIFIED 2026-10-21 22:40 +07)

| Surface | Port | Release / unit | Inference |
|---------|------|----------------|-----------|
| Production | 8787 | `5ae20af` / `agent-core.service` PID `3130339` | **closed** (no `inference` scope, production pilot guard). Health `groq_inference_enabled: false` |
| Staging | 8788 | `5ae20af` / `agent-core-groq-staging.service` PID `3305713` | fast/reasoning/frontier **PASS**. Project `groq-staging-v237`, scope `inference` only |

Evidence (no secrets in git): production audit `~/agent-core/logs/audit.jsonl`. Staging ledger, breaker, and audit under `~/agent-core/logs/groq-staging-v237/`.

## Limitations

- Do not repoint `current` or edit the production env to turn inference on.
- Frontier is allowed only because staging is `development` and `INFERENCE_FRONTIER_ENABLED=true`. Production hard-blocks frontier.
- Jev upstream timeout on production is `OPENROUTER_TIMEOUT_MS=8000`. The 22:36 +07 call finished in 899 ms. A cold start can still fall back inside that limit.
- Staging breaker state is per host file next to the staging ledger. Empty `{}` means closed.
- ADR 0002 (PR #39) remains an open draft.
- Obsidian: [handoff only](./OBSIDIAN_HANDOFF_2026-10-21.md) — not written by this closeout.

## Documentation map

- Groq integration: [GROQ_INFERENCE_PILOT.md](../integrations/GROQ_INFERENCE_PILOT.md), [HERMES_READONLY_INFERENCE_PILOT.md](../pilots/HERMES_READONLY_INFERENCE_PILOT.md)
- Multi-provider: [0003-multi-provider-inference-routing.md](../adr/0003-multi-provider-inference-routing.md)
- Platform checkpoint: [STATUS.md](../STATUS.md)
- Memory index: [README.md](./README.md)
