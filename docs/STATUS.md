# Platform Status

## Current runtime line

- **Agent Core runtime version:** `0.6.0`
- **Deployed release:** `~/agent-core/releases/fca4f8f` (merged `main`, PR #14 + PR #15) on host `10.1.254.237`
- **Architecture:** Agent Core v2 AI Control Plane
- **v1 API compatibility:** preserved (verified live: `/v1/decision`, `/v1/route`, `/v1/qa`, `/v1/context`, `/v1/subagent`, `/v1/advanced-route`, `/v1/projects`, `/v1/metrics`, `/v1/control-metrics` all 200)
- **V2-8 production activation:** executed, verified and reported —
  [V2_PRODUCTION_ACTIVATION_REPORT.md](V2_PRODUCTION_ACTIVATION_REPORT.md) ·
  [V2_LIVE_QA_REPORT.md](V2_LIVE_QA_REPORT.md) ·
  [V2_BENCHMARK_REPORT.md](V2_BENCHMARK_REPORT.md) ·
  [V2_ROLLBACK_RUNBOOK.md](V2_ROLLBACK_RUNBOOK.md)
- **Declared readiness:** `AGENT_CORE_V2_PRODUCTION_READY=YES` — both earlier blockers (edge rate-limit
  coverage of `/v2/*`, browser execution wiring) are closed with live evidence: 112/112 QA cases,
  54/54 benchmark samples, rollback rehearsed (1.21 s window).

## v1 foundation

| Phase | Status | Notes |
|---|---|---|
| 0 Architecture Foundation | COMPLETE | Blueprint, architecture, security, API foundation |
| 1 Jev Decision Core | COMPLETE | Jev Decisions API adapter, confidence/fallback, tests |
| 2 VPS + Cloudflare package | COMPLETE + LIVE | user-space systemd layout, tunnel, Access, edge rate limit on `/control`, `/v1/*`, `/v2/*` |
| 3 52Clips Pilot | LIVE VERIFIED | real decision through the edge (`GENERATE_SUBTITLE`) |
| 4 Shared Client | COMPLETE | CLI health/doctor/decision/route/qa |
| 5 Existing Project Adapters | COMPLETE | 52Clips, attendance, handbook, goffice2026, dbplant profiles |
| 6 Context Intelligence | COMPLETE v1 | deterministic bounded candidate ranking |
| 7 Advanced Routing | COMPLETE v1 | sensitivity/cost routing, hard-policy gate, subagent dedupe |
| 8 Control Center | COMPLETE v1 | private API-backed control-center surface |

## v2 implementation

| Phase | Status | Notes |
|---|---|---|
| V2-0 Baseline Freeze | COMPLETE | v1 baseline kept for rollback (`releases/188de03`, `releases/9d2e9a9`) |
| V2-1 Capability Registry + Unified Router | COMPLETE + LIVE | 7 capabilities, routing matrix verified live |
| V2-2 Gateway / Interceptor | COMPLETE + LIVE | progressive disclosure, execution contracts; nothing executes without policy |
| V2-3 Context Governor | COMPLETE + LIVE | KEEP/COMPRESS/DROP/PIN live; protected context never dropped; reduction 0.40–0.51 |
| V2-4 Browser Control Plane | COMPLETE + LIVE | policy pipeline live, plus **live MCP execution** behind scope/policy/guards/approval and the `PLAYWRIGHT_MCP_EXECUTION_ENABLED` kill switch |
| V2-5 Supervisor | COMPLETE | 10/10 decision matrix verified at module level (no HTTP route in v0.6.0) |
| V2-6 Control Center v2 | COMPLETE + LIVE | `/control` 200 internally, 302 behind Access externally, browser state shown as HANDOFF |
| V2-7 Project migration | COMPLETE CONTRACTS | five adapters migrated; runtime scope/policy behaviour verified per project |
| V2-8 Production activation + benchmark | COMPLETE | 112/112 QA cases, 54/54 benchmark samples, rollback + MCP-disable rehearsed, readiness `YES` |

## Project migration state (live behaviour verified)

- `52clips`: router/gateway/context/supervisor enabled; browser scope absent → `/v2/browser/*` 403.
- `attendance-report-generator`: deterministic-first document workflow; browser 403.
- `handbook`: browser planning **and** live read/navigate execution with receipts; publishing stays human-approved.
- `goffice2026`: browser planning + execution allowed; production deployment stays human-approved (`APPROVAL_REQUIRED`).
- `dbplant`: read-only default retained; gateway unreachable with the production identity (no `route` scope); isolated policy path returns `APPROVAL_REQUIRED DBPLANT_READ_ONLY_DEFAULT` for writes and 403 for browser capabilities.

Adapter declarations do not grant execution permission. Hard policy, machine-identity scopes,
environment rules and explicit approvals remain authoritative.

## Browser execution state

- Transport: `@playwright/mcp` 0.0.82 + Chromium 1246, `agent-core-browser-mcp.service` on `127.0.0.1:8791`
  (`MemoryMax=1G`, `CPUQuota=150 %`, `TasksMax=512`, host-header allowlist, blocked origins).
- Execution: `POST /v2/browser/execute` runs the mandated pipeline
  (auth → scope → hard policy → browser control → URL/SSRF guard → injection guard → approval → MCP)
  and produces receipts, audit rows and metrics.
- Kill switch: `PLAYWRIGHT_MCP_EXECUTION_ENABLED` (code default `false`; enabled on host 237).
- Failure semantics: MCP down → `503 MCP_UNAVAILABLE` within the timeout, nothing executed.

## Known open items (verified warnings)

1. No `package-lock.json` in the repository → `npm ci` is not possible (reproducibility gap).
2. Requests with `User-Agent: python-urllib/*` are refused at the edge (Cloudflare error 1010) while `curl`/CLI user agents succeed.
3. No HTTP route for the Supervisor in v0.6.0 (module-level verification only).
4. Adapter YAML feature flags are declarative contracts, not runtime-enforced permissions.
5. The browser URL guard is literal — DNS names resolving to private addresses (rebinding) are not caught.
6. `/v1/control-metrics` carries no application-level auth (loopback + edge protection only).
7. `/v2/*` is protected by project-token auth plus the edge rate limit, but has no Cloudflare Access application.
8. Branch `ops/production-activation` (PR #4) is stale lineage and needs an owner decision.

## External activation state

Live infrastructure verification is documented with raw evidence in `docs/evidence/v2-8/`: OpenRouter/Jev
calls succeed and fail explicitly, Cloudflare TLS/Access/tunnel/rate-limit behave as designed, the
origin stays loopback-only, the browser MCP runtime both transports and executes approved actions, and
rollback (service, config, edge rule, browser runtime) is rehearsed.
