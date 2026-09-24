# Platform Status

## Current runtime line

- **Agent Core runtime version:** `0.6.0`
- **Architecture:** Agent Core v2 AI Control Plane
- **v1 API compatibility:** preserved (verified live on host 237: `/v1/decision`, `/v1/route`, `/v1/qa`, `/v1/context`, `/v1/subagent`, `/v1/advanced-route`, `/v1/projects`, `/v1/metrics`, `/v1/control-metrics` all 200)
- **Production activation (V2-8):** executed and verified on host `10.1.254.237` — see
  [V2_PRODUCTION_ACTIVATION_REPORT.md](V2_PRODUCTION_ACTIVATION_REPORT.md),
  [V2_LIVE_QA_REPORT.md](V2_LIVE_QA_REPORT.md),
  [V2_BENCHMARK_REPORT.md](V2_BENCHMARK_REPORT.md),
  [V2_ROLLBACK_RUNBOOK.md](V2_ROLLBACK_RUNBOOK.md)
- **Declared readiness:** `AGENT_CORE_V2_PRODUCTION_READY=BLOCKED` — two open acceptance items
  (Cloudflare edge rate-limit coverage of `/v2/*`; browser MCP runtime proven but not wired into
  gateway execution). No safety failure was found; every security invariant held.

## v1 foundation

| Phase | Status | Notes |
|---|---|---|
| 0 Architecture Foundation | COMPLETE | Blueprint, architecture, security, API foundation |
| 1 Jev Decision Core | COMPLETE | Jev Decisions API adapter, confidence/fallback, tests |
| 2 VPS + Cloudflare package | COMPLETE + LIVE | Docker/systemd/Tunnel templates; live user-space activation verified on host 237 |
| 3 52Clips Pilot | LIVE VERIFIED | real decision through the edge returned `GENERATE_SUBTITLE` |
| 4 Shared Client | COMPLETE | CLI health/doctor/decision/route/qa |
| 5 Existing Project Adapters | COMPLETE | 52Clips, attendance, handbook, goffice2026, dbplant profiles |
| 6 Context Intelligence | COMPLETE v1 | Deterministic bounded candidate ranking; avoids whole-repo default |
| 7 Advanced Routing | COMPLETE v1 | sensitivity/cost routing, hard-policy gate, subagent dedupe |
| 8 Control Center | COMPLETE v1 | private API-backed control-center surface |

## v2 implementation

| Phase | Status | Notes |
|---|---|---|
| V2-0 Baseline Freeze | COMPLETE | v1 baseline preserved for rollback (`releases/188de03`, `releases/9d2e9a9`) |
| V2-1 Capability Registry + Unified Router | COMPLETE + LIVE | 7 capabilities verified live (`/v2/capabilities`), routing matrix verified (`/v2/route`) |
| V2-2 Gateway / Interceptor | COMPLETE + LIVE | progressive disclosure, execution contracts (`/v2/execute`), `executed:false` everywhere |
| V2-3 Context Governor | COMPLETE + LIVE | KEEP/COMPRESS/DROP/PIN verified live; protected context never dropped; reduction 0.40–0.51 |
| V2-4 Browser Control Plane | LIVE (transport) | policy-controlled handoff verified live; Playwright MCP runtime installed and proven; gateway execution remains HANDOFF |
| V2-5 Supervisor | COMPLETE | deterministic workflow decisions verified at module level (10/10); no HTTP route in v0.6.0 |
| V2-6 Control Center v2 | COMPLETE + LIVE | `/control` 200 internally, 302 behind Cloudflare Access externally; browser status shown as HANDOFF |
| V2-7 Project migration | COMPLETE CONTRACTS | all five adapters migrated; runtime scope/policy behaviour verified per project |
| V2-8 Production activation + benchmark | EXECUTED (BLOCKED on 2 items) | live QA 58/58 + 14/14 + 10/10 + 8/8, benchmark 45/45, rollback rehearsed (2.31 s) |

## Project migration state (live behaviour verified on host 237)

- `52clips`: v2 router/gateway/context/supervisor enabled; browser scope absent → browser surface 403.
- `attendance-report-generator`: v2 deterministic-first document workflow; browser 403.
- `handbook`: v2 browser planning enabled (`browser` scope) with receipts; production publishing remains human-approved.
- `goffice2026`: v2 browser planning enabled; production deployment remains human-approved (write → `APPROVAL_REQUIRED`).
- `dbplant`: read-only default retained; gateway unreachable with the production identity (no `route` scope); isolated policy path returns `APPROVAL_REQUIRED DBPLANT_READ_ONLY_DEFAULT` for writes and 403 for browser capabilities; destructive → approval.

Project adapter declarations do not grant execution permission. Hard policy, machine identity scopes, environment rules, and explicit approvals remain authoritative.

## Browser activation state

`mcp.playwright` is an **ACTIVE control-plane capability** with execution mode `HANDOFF`.

- Live transport **is now proven**: `@playwright/mcp` 0.0.82 + Chromium 1246, MCP stdio session
  navigated a real page and evaluated the DOM; loopback/metadata/`file://` targets refused; no orphan
  browser processes; persistent runtime `agent-core-browser-mcp.service` on `127.0.0.1:8791` with
  `MemoryMax=1G`, `CPUQuota=150 %`, `TasksMax=512`.
- Agent Core still does **not** execute browser actions: every browser request returns a
  policy-checked contract with `executed:false`. Wiring one narrow, policy-gated execution path is
  the remaining open item before browser execution can be called live.
- Security hardening added in V2-8: IPv6 loopback / link-local / ULA / IPv4-mapped / decimal-IP /
  hex-IP targets are now denied, and browser-class capabilities require the `browser` scope at
  `/v2/execute`.

## Known open items (verified warnings)

1. No `package-lock.json` in the repository → `npm ci` is not possible (reproducibility gap).
2. The Cloudflare edge rate-limit rule and Access applications cover `/control` and `/v1/*`, not `/v2/*`.
3. Requests with `User-Agent: python-urllib/*` are refused at the edge (Cloudflare error 1010) while `curl`/CLI user agents succeed.
4. No HTTP route for the Supervisor in v0.6.0 (module-level verification only).
5. Adapter YAML feature flags are declarative contracts, not runtime-enforced permissions.
6. The browser URL guard cannot see DNS names that resolve to private addresses (rebinding).
7. `/v1/control-metrics` carries no application-level auth (loopback + edge protection only).
8. Branch `ops/production-activation` (PR #4) is stale lineage and needs an owner decision.

## External activation state

Live infrastructure verification has been performed on host `10.1.254.237` and is documented with
raw evidence in `docs/evidence/v2-8/`. Live activation claims remain limited to what was actually
observed: OpenRouter/Jev calls succeed, Cloudflare TLS/Access/tunnel work, the origin stays
loopback-only, and the browser MCP transport runs — with the two blockers listed above.
