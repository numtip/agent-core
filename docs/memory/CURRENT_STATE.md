# Agent Core — current state

**Last updated:** 2026-10-13  
**GitHub `main`:** `8e77ab5` (PR #26)

## Architecture

- **Control plane:** Fastify API — policy, Jev decisions, v2 routing, knowledge fabric (merged #21), browser plan/execute gates.
- **Jev:** OpenRouter Decisions API; projects call Agent Core, not Jev directly.
- **REA integration:** `POST /v2/rea/route` — Jev `TOOL_ROUTE` over a **deterministic allowlist**; returns Cursor MCP handoff (`user-rea`), does not run REA on the server.
- **Capability registry:** `mcp.rea` = **PLANNED**, **HANDOFF**, no VPS/control-plane execution.

## REA allowlist profiles

| Profile | Default | Tools |
|---------|---------|--------|
| v1 | **yes** | `binary_session`, `analyze_javascript_application` (synthetic inbox path) |
| v2 | opt-in | v1 + `trace_web_module_imports`, `trace_web_source_location` (workspace-bounded paths; route → human review for PROCESS) |

Env: `REA_LOCAL_HANDOFF_ENABLED`, `REA_WORKSPACE_ROOTS`, `REA_ALLOWLIST_PROFILE`, `REA_PACKAGE_VERSION`.

## Local vs production

| Surface | State |
|---------|--------|
| GitHub `main` | **VERIFIED** @ `8e77ab5` |
| Local Agent Core dev | `F:\projectAi\agent-core`; `.env` gitignored |
| REA sandbox | `F:\projectAi\REA`; MCP via Cursor |
| VPS / Cloudflare production | **Not updated** by 2026-10-13 REA work |

## Documentation map

- Integrations: [JEV_REA_LOCAL_INTEGRATION.md](../integrations/JEV_REA_LOCAL_INTEGRATION.md), [JEV_REA_ROUTING_V2.md](../integrations/JEV_REA_ROUTING_V2.md)
- Audits: [../audits/README.md](../audits/README.md)
- Memory: [README.md](./README.md)
