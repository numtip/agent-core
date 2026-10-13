# Agent Core — current state

**Last updated:** 2026-10-13 (VPS pointer check)  
**GitHub `main` at this writing:** `93afa3e` (PR #28)  
**Production:** `releases/dbe20a5` (`dbe20a5543c07996aafc9f39ceb050007ce79842`), package `0.7.0`, 8 capabilities, 6 identities. Rollback `releases/01092e2`. Not restarted for the doc update.

## Architecture

- **Control plane:** Fastify API — policy, Jev decisions, v2 routing, knowledge fabric (merged #21), browser plan/execute gates.
- **Jev:** OpenRouter Decisions API; projects call Agent Core, not Jev directly.
- **REA integration:** `POST /v2/rea/route` — Jev `TOOL_ROUTE` over a **deterministic allowlist**; returns Cursor MCP handoff (`user-rea`), does not run REA on the server.
- **Capability registry:** production binary has **8** capabilities ending at `knowledge.openwiki`. On `main`, `mcp.rea` is **PLANNED**, **HANDOFF**, `vps_execution: false`, and is not in the deployed registry.

## REA allowlist profiles

| Profile | Default | Tools |
|---------|---------|--------|
| v1 | **yes** | `binary_session`, `analyze_javascript_application` (synthetic inbox path) |
| v2 | opt-in | v1 + `trace_web_module_imports`, `trace_web_source_location` (workspace-bounded paths; route → human review for PROCESS) |

Env: `REA_LOCAL_HANDOFF_ENABLED`, `REA_WORKSPACE_ROOTS`, `REA_ALLOWLIST_PROFILE`, `REA_PACKAGE_VERSION`.

## Local vs production

| Surface | State |
|---------|--------|
| GitHub `main` | `93afa3e` at this writing (PR #28). Ahead of production |
| Local Agent Core dev | `F:\projectAi\agent-core`; `.env` gitignored |
| REA sandbox | `F:\projectAi\REA`; MCP via Cursor |
| VPS production | **DEPLOYED** `dbe20a5` / `0.7.0` since 2026-10-12. REA route and observation/memory capabilities are **not** on that release |

## Documentation map

- Integrations: [JEV_REA_LOCAL_INTEGRATION.md](../integrations/JEV_REA_LOCAL_INTEGRATION.md), [JEV_REA_ROUTING_V2.md](../integrations/JEV_REA_ROUTING_V2.md)
- Audits: [../audits/README.md](../audits/README.md)
- Memory: [README.md](./README.md)
