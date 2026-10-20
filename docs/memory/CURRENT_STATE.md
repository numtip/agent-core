# Agent Core — current state

**Last updated:** 2026-10-14 16:27 +07 (session close)  
**Status:** `TOOLING_HARDENED` · `LIVE_ACTIVATION_BLOCKED_ON_CREDENTIALS` · `TOKEN_ROTATION_DEFERRED`  
**GitHub `main`:** `cb4ff559a2263bdfcb1de8c1f7fd4f92caafc423` (PR #35, `ops/` + docs). PR #34 `8d7228d` also merged today. Neither touches runtime. PR #36 is **OPEN** (`fix/handoff-replace-confirmation`).  
**Production:** `releases/dbe20a5` (`dbe20a5543c07996aafc9f39ceb050007ce79842`), package `0.7.0`, 8 capabilities in the deployed registry, 6 identities. **Unchanged and untouched today** — no deploy, no restart, no Cloudflare change. Verify the pointer before any deploy with the commands in [NEXT_SESSION.md](./NEXT_SESSION.md).

## Where to start

[2026-10-14.md](./2026-10-14.md) — today's timeline, defects fixed, and the precise activation
blocker. [NEXT_SESSION.md](./NEXT_SESSION.md) — the one immediate next step.

## Architecture

- **Control plane:** Fastify API — policy, Jev decisions, v2 routing, knowledge fabric (merged #21), browser plan/execute gates.
- **Jev:** OpenRouter Decisions API; projects call Agent Core, not Jev directly.
- **REA integration:** `POST /v2/rea/route` — Jev `TOOL_ROUTE` over a **deterministic allowlist**; returns Cursor MCP handoff (`user-rea`), does not run REA on the server.
- **Capability registry:** production binary has **8** capabilities, ending at `knowledge.openwiki` (counted in `releases/dbe20a5/dist/src/capability-registry.js` on 2026-10-13). Source on `main` adds `knowledge.observation`, `knowledge.memory-store`, and `mcp.rea` (11). `mcp.rea` is **PLANNED**, **HANDOFF**, `vps_execution: false`. Reverse-skill audit: **ADOPT 0 / EXTEND 0**, nothing installed ([REVERSE_SKILL_GAP_AUDIT_20261013.md](../audits/REVERSE_SKILL_GAP_AUDIT_20261013.md)).

## Security boundary

Merged on `main`, not in the running process. Full checkpoint: [../STATUS.md](../STATUS.md#security-closeout--2026-10-13).

- Origin auth for `/control` and `/v1/control-metrics` fails closed (503 if `AGENT_CORE_CF_ACCESS_TEAM_DOMAIN` or `AGENT_CORE_CF_ACCESS_AUD` is unset).
- SSRF: non-global addresses and failed DNS are denied, and the final page URL is re-checked. The egress proxy is **not** installed, so redirects and a short rebinding window remain until a later approved deploy.
- Browser input is one MCP session. That fix is not running on `dbe20a5`.
- Ops scripts in git are hardened. Host copies under `~/agent-core/ops/` were not replaced. Backup `~/agent-core/backups/ops-audit-20261013-223304/` stays in place.
- `npm audit --omit=dev`: 0. Dev-only `vitest` `^3.0.0` still has 3 advisories (1 moderate, 2 critical). No upgrade in this closeout.
- Token rotation: **DEFERRED** by owner decision (2026-10-14). The six identities exposed in the 2026-10-13 session log remain unrotated — an accepted risk, not an oversight. Do not read or rotate credentials from this note.
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
| GitHub `main` | `cb4ff55` (PR #35). PR #34 `8d7228d` also merged today. `ops/` + docs only — no runtime change. Ahead of production; deploy pending |
| Open PR | [#36](https://github.com/numtip/agent-core/pull/36) `fix/handoff-replace-confirmation` — replace-confirmation gate and pipe-closure safety, CI green, not merged |
| Local Agent Core dev | `F:\projectAi\agent-core`; `.env` gitignored |
| Local adapter (not published) | `G:\ProjectAI\agent-core-local` — DPAPI-backed Cursor adapter, mock QA 28/28, ops handoff. Deliberately outside this repo |
| REA sandbox | `F:\projectAi\REA`; MCP via Cursor |
| VPS production | **DEPLOYED** `dbe20a5` / `0.7.0` since 2026-10-12. Unchanged today. REA route and observation/memory capabilities are **not** on that release |

## Documentation map

- Integrations: [JEV_REA_LOCAL_INTEGRATION.md](../integrations/JEV_REA_LOCAL_INTEGRATION.md), [JEV_REA_ROUTING_V2.md](../integrations/JEV_REA_ROUTING_V2.md)
- Audits: [../audits/README.md](../audits/README.md), [REVERSE_SKILL_GAP_AUDIT_20261013.md](../audits/REVERSE_SKILL_GAP_AUDIT_20261013.md)
- Security and ops (merged, not deployed): [SECURITY_HARDENING_2026-10.md](../SECURITY_HARDENING_2026-10.md), [OPS_TOOLING_HARDENING_2026-10.md](../OPS_TOOLING_HARDENING_2026-10.md), [STATUS.md](../STATUS.md)
- Memory: [README.md](./README.md), [2026-10-14.md](./2026-10-14.md), [2026-10-13.md](./2026-10-13.md)
