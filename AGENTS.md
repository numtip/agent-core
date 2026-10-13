# Agent instructions — `numtip/agent-core`

Lead agents working this repository must follow production-safe, read-first rules.

## Before changes

1. Read [docs/STATUS.md](docs/STATUS.md) and the latest [docs/audits/](docs/audits/) entry.
2. Read [SECURITY.md](SECURITY.md) and [docs/PROJECT_INTEGRATION.md](docs/PROJECT_INTEGRATION.md).
3. Inspect `git status`, `git log -5`, and open PRs — do not assume deploy equals `main`.
4. Use Hermes `hermes_memory` / `hermes_session_search` for prior decisions; do not duplicate memory stores.

## Labels (required in reports)

- **IMPLEMENTED** — merged code/tests  
- **DEPLOYED** — on VPS  
- **ACTIVATED** — credentials/scopes/live use  
- **VERIFIED** — audit or QA with SHA/date  

## Hard stops (human approval)

- Production deploy, restart, credential rotation, Cloudflare rule changes  
- `git push`, merge to `main`, or force operations  
- Disabling auth, scopes, SSRF/browser guards, or MCP kill switches  
- Storing secrets in git or public memory repos  

## Architecture authority

- [BLUEPRINT.md](BLUEPRINT.md) · [docs/AGENT_CORE_V2_BLUEPRINT.md](docs/AGENT_CORE_V2_BLUEPRINT.md)  
- Adapter YAML is **declarative**; hard policy + scopes + human approval are **authoritative**.
