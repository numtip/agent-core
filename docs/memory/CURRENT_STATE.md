# Agent Core — current state

**Last updated:** 2026-10-21 (+07) daily closeout  
**Status:** `GROQ_STAGING_LIVE` · `PRODUCTION_JEV_UNCHANGED` · `GOVERNANCE_PR_OPEN`  
**GitHub `main`:** `41195f6e6f06cbfa4b5cdc3efa0b3b79d87ccfbd` (PR #38 — Groq inference pilot). Open: PR [#39](https://github.com/numtip/agent-core/pull/39) governance draft.  
**Production VPS:** `releases/dbe20a5` on `:8787` — **unchanged**; Groq is **not** on `current`.  
**Groq staging VPS:** `releases/41195f6` on `:8788`, unit `agent-core-groq-staging.service` — **isolated pilot**, not production activation.

## Where to start

[2026-10-21.md](./2026-10-21.md) — today's timeline and evidence paths. [NEXT_SESSION.md](./NEXT_SESSION.md) — resume steps.

## Architecture (unchanged core)

- **Jev / decisions:** OpenRouter on production `:8787` only.
- **Groq inference (new on `main`):** `POST /v2/inference/complete`, scope `inference`, ADR [0001](../adr/0001-groq-inference-pilot.md) — **production VPS NO-GO**; staging uses `development` env on `:8788`.
- **Hermes:** Skill `~/.hermes/skills/integrations/agent-core-groq-inference/` — CONTEXT_ONLY HTTP handoff to staging.

## VPS surfaces (VERIFIED 2026-10-21)

| Surface | Port | Release / unit | Groq |
|---------|------|----------------|------|
| Production | 8787 | `dbe20a5` / `agent-core.service` | inference routes **404** |
| Staging pilot | 8788 | `41195f6` / `agent-core-groq-staging.service` | active, `openai/gpt-oss-120b`, fallback **off**, budget **$10** |

Evidence directory (no secrets in git): `~/agent-core/logs/groq-staging-v237/` on host 237.

## Limitations

- Staging ≠ production; do not repoint `current` or prod env for Groq.
- ADR 0002 (PR #39) owner approval pending for formal exception wording.
- Obsidian canonical note: [handoff only](./OBSIDIAN_HANDOFF_2026-10-21.md) — not auto-written.

## Documentation map

- Groq integration: [GROQ_INFERENCE_PILOT.md](../integrations/GROQ_INFERENCE_PILOT.md), [HERMES_READONLY_INFERENCE_PILOT.md](../pilots/HERMES_READONLY_INFERENCE_PILOT.md)
- Platform checkpoint: [STATUS.md](../STATUS.md)
- Memory index: [README.md](./README.md)
