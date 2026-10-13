# Agent Core — current state

**Last updated:** 2026-10-13 23:16 +07 (security closeout)  
**Status:** `SECURITY_SOURCE_MERGED — PRODUCTION_PENDING`  
**GitHub `main`:** `607b41e230a25a99c3481702a4260738b8d354af` (PR #31). PR #30 is `0b8eed9738df7497b84464f8e04022d506cd0c5a`. Both MERGED.  
**Production:** `releases/dbe20a5` (`dbe20a5543c07996aafc9f39ceb050007ce79842`), package `0.7.0`, health `version: 0.7.0`, MainPID `2891042` since 2026-10-12 13:03:42 +07, browser MCP MainPID `3563237`. `current` → `releases/dbe20a5`. 8 capabilities, 6 identities. Service rollback `releases/01092e2`. Not restarted for this doc update.

## Architecture

- **Control plane:** Fastify API — policy, Jev decisions, v2 routing, knowledge fabric (merged #21), browser plan/execute gates.
- **Jev:** OpenRouter Decisions API; projects call Agent Core, not Jev directly.
- **REA integration:** `POST /v2/rea/route` — Jev `TOOL_ROUTE` over a **deterministic allowlist**; returns Cursor MCP handoff (`user-rea`), does not run REA on the server.
- **Capability registry:** production binary has **8** capabilities ending at `knowledge.openwiki`. On `main`, `mcp.rea` is **PLANNED**, **HANDOFF**, `vps_execution: false`, and is not in the deployed registry.

## Security boundary

Merged on `main`, not in the running process. Full checkpoint: [../STATUS.md](../STATUS.md#security-closeout--2026-10-13).

- Origin auth for `/control` and `/v1/control-metrics` fails closed (503 if `AGENT_CORE_CF_ACCESS_TEAM_DOMAIN` or `AGENT_CORE_CF_ACCESS_AUD` is unset).
- SSRF: non-global addresses and failed DNS are denied, and the final page URL is re-checked. The egress proxy is **not** installed, so redirects and a short rebinding window remain until a later approved deploy.
- Browser input is one MCP session. That fix is not running on `dbe20a5`.
- Ops scripts in git are hardened. Host copies under `~/agent-core/ops/` were not replaced. Backup `~/agent-core/backups/ops-audit-20261013-223304/` stays in place.
- `npm audit --omit=dev`: 0. Dev-only `vitest` `^3.0.0` still has 3 advisories (1 moderate, 2 critical). No upgrade in this closeout.
- Token rotation: **OWNER-MANAGED / PENDING**. Do not read or rotate credentials from this note.
- [PR #4](https://github.com/numtip/agent-core/pull/4): **OPEN / CONFLICTING**. Leave it. Do not rebase or close it from this checkpoint.

## REA allowlist profiles

| Profile | Default | Tools |
|---------|---------|--------|
| v1 | **yes** | `binary_session`, `analyze_javascript_application` (synthetic inbox path) |
| v2 | opt-in | v1 + `trace_web_module_imports`, `trace_web_source_location` (workspace-bounded paths; route → human review for PROCESS) |

Env: `REA_LOCAL_HANDOFF_ENABLED`, `REA_WORKSPACE_ROOTS`, `REA_ALLOWLIST_PROFILE`, `REA_PACKAGE_VERSION`.

## Local vs production

| Surface | State |
|---------|--------|
| GitHub `main` | `607b41e` (PR #30 and #31 merged). Ahead of production. Security source is merged; deploy is pending |
| Local Agent Core dev | `F:\projectAi\agent-core`; `.env` gitignored |
| REA sandbox | `F:\projectAi\REA`; MCP via Cursor |
| VPS production | **DEPLOYED** `dbe20a5` / `0.7.0` since 2026-10-12. REA route and observation/memory capabilities are **not** on that release |

## Documentation map

- Integrations: [JEV_REA_LOCAL_INTEGRATION.md](../integrations/JEV_REA_LOCAL_INTEGRATION.md), [JEV_REA_ROUTING_V2.md](../integrations/JEV_REA_ROUTING_V2.md)
- Audits: [../audits/README.md](../audits/README.md)
- Memory: [README.md](./README.md)
