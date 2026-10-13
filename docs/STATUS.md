# Platform Status

## Current runtime line

Verified on VPS `ubantu24` (`10.1.254.237`) at 2026-10-13 22:15 +07 by reading the live user unit. No restart and no deploy were part of that check. The morning audit that still says the live SHA is unknown is historical: [audits/AGENT_CORE_REALITY_AUDIT_20261013.md](audits/AGENT_CORE_REALITY_AUDIT_20261013.md).

- **Deployed package:** `0.7.0`. Loopback `GET http://127.0.0.1:8787/v1/health` returned `status: ok`, `version: 0.7.0`, `auth_required: true`, `provider_configured: true`, model `~typesafe/jev-latest`.
- **Deployed release:** `~/agent-core/releases/dbe20a5` (`dbe20a5543c07996aafc9f39ceb050007ce79842`). `current` points there. `agent-core.service` has been active since 2026-10-12 13:03 +07 (user-space systemd, Node v22.22.2).
- **Rollback release:** `~/agent-core/releases/01092e2` (parent of the deployed commit). v1 baselines `releases/188de03` and `releases/9d2e9a9` are still on disk and are not the current symlink.
- **Production capabilities (8):** `deterministic.runtime`, `model.frontier`, `agent.cursor`, `agent.codex`, `agent.hermes`, `tool.git`, `mcp.playwright`, `knowledge.openwiki`. Counted in the deployed `dist/src/capability-registry.js`.
- **Production project identities (6):** `52clips`, `attendance-report-generator`, `handbook`, `goffice2026`, `dbplant`, `rae-attendance-v2`. `rae-attendance-v2` is activated with scope `decision` only. Tokens are not recorded in this file.
- **GitHub `main` is not this release.** At documentation time `main` was `93afa3e` (PR #28), eight commits after `dbe20a5`. Those commits are **not deployed**. Source on `main` registers **11** capabilities and a seventh profile, `agent-core`, and adds `POST /v2/rea/route`. See [Undeployed commits](#undeployed-commits-on-main).
- **Architecture:** Agent Core v2 AI Control Plane.
- **v1 API compatibility:** preserved on the V2-8 baseline (historical live check of `/v1/decision`, `/v1/route`, `/v1/qa`, `/v1/context`, `/v1/subagent`, `/v1/advanced-route`, `/v1/projects`, `/v1/metrics`, `/v1/control-metrics`). This 2026-10-13 VPS pass re-checked `/v1/health` only.
- **Historical V2-8 pack:** `~/agent-core/releases/4246c0a` on 2026-09-25 remains the last full 112/112 QA and benchmark record. It is not the running release.
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
| V2-1 Capability Registry + Unified Router | COMPLETE + LIVE | **8** capabilities in the deployed `dbe20a5` binary. `main` source adds `knowledge.observation`, `knowledge.memory-store`, and `mcp.rea` (11 total); those three are not deployed |
| V2-2 Gateway / Interceptor | COMPLETE + LIVE | progressive disclosure, execution contracts; nothing executes without policy |
| V2-3 Context Governor | COMPLETE + LIVE | KEEP/COMPRESS/DROP/PIN live; protected context never dropped; reduction 0.40–0.51 |
| V2-4 Browser Control Plane | COMPLETE + LIVE | policy pipeline live, plus **live MCP execution** behind scope/policy/guards/approval and the `PLAYWRIGHT_MCP_EXECUTION_ENABLED` kill switch |
| V2-5 Supervisor | COMPLETE | 10/10 decision matrix verified at module level. Deployed `0.7.0` still has no Supervisor HTTP route |
| V2-6 Control Center v2 | COMPLETE + LIVE | `/control` 200 internally, 302 behind Access externally, browser state shown as HANDOFF |
| V2-7 Project migration | COMPLETE CONTRACTS | Six production identities. Behavioural checks below are the V2-8 record plus the 2026-10-12 `rae-attendance-v2` activation. The `agent-core` profile exists only in `main` source |
| V2-8 Production activation + benchmark | COMPLETE | 112/112 QA cases, 54/54 benchmark samples, rollback + MCP-disable rehearsed, readiness `YES` |
| V2-9 Knowledge Fabric / OpenWiki | DEPLOYED · transport ACTIVATION-GATED | Deployed binary serves `POST /v2/knowledge/query` (scope `context`) for `knowledge.openwiki` only. Observation and memory-store sources exist on `main` and are not in this binary. Live OpenWiki transport was not probed on 2026-10-13 |
| PR #19 `rae-attendance-v2` | DEPLOYED · ACTIVATED | On `dbe20a5` since 2026-10-12. Host scope is exactly `["decision"]`. No route, qa, context, metrics, or browser scope |

## Project migration state

Scope names below were read from the host scope map on 2026-10-13. Per-route behaviour for the original five projects is the V2-8 live record, not a new pass.

- `52clips`: scopes `context`, `decision`, `metrics`, `qa`, `route`. Browser scope absent.
- `attendance-report-generator`: scopes `context`, `decision`, `qa`, `route`. Deterministic-first document workflow in the V2-8 record; no browser scope.
- `handbook`: scopes `browser`, `context`, `decision`, `qa`, `route`. V2-8 record: browser planning and live read/navigate with receipts; publishing stays human-approved.
- `goffice2026`: scopes `browser`, `context`, `decision`, `metrics`, `qa`, `route`. V2-8 record: browser planning and execution allowed; production deployment stays human-approved (`APPROVAL_REQUIRED`).
- `dbplant`: scopes `context`, `decision`. No `route` scope. Read-only default retained in the V2-8 record.
- `rae-attendance-v2`: scope `decision` only. Adapter is present in the deployed tree. Production SSO stays human-approved.

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

## Known limitations

Checked in the deployed tree or the live unit on 2026-10-13 unless noted.

1. Deployed commit `dbe20a5` does not contain `package-lock.json`. `main` added one in PR #24. The on-disk release directory has a lockfile produced when that release was promoted; it is not the git blob from `main`.
2. The deployed provider client uses one attempt and `OPENROUTER_TIMEOUT_MS=8000`. The running `dist` has no retry loop, `provider_attempts`, or `reason_code`. No such commit is on `main`.
3. `dist/src/auth.js` uses `Object.hasOwn` for scopes and still reads `projectKeys[project]` without it. Not changed in this documentation update.
4. No HTTP route for the Supervisor in deployed `0.7.0` (module-level only).
5. `GET /v1/control-metrics` has no application auth guard in the deployed `app.js` (loopback bind plus edge protection).
6. `/v2/*` has project-token auth and the edge rate limit. The 2026-10-12 activation record says there is no Cloudflare Access application in front of `/v2/*`. The public edge was not re-probed on 2026-10-13.
7. Adapter YAML feature flags are declarative contracts, not runtime-enforced permissions.
8. The browser URL guard is literal. DNS rebinding was not re-tested on 2026-10-13; the limitation stands from the prior review.
9. `User-Agent: python-urllib/*` was refused at the edge (Cloudflare error 1010) in an earlier check. Not re-tested on 2026-10-13.
10. `ops/production-activation` (PR #4) is still open and is not the deployed SHA.
11. `PLAYWRIGHT_MCP_EXECUTION_ENABLED=true` on the host. Browser scope is held by `goffice2026` and `handbook` only.

## Undeployed commits on main

`origin/main` at `93afa3e` contains runtime that the VPS is not running. Do not treat these as production.

| Commits | What landed in git | If it were deployed |
|---|---|---|
| `#21` `f736bc7` | `knowledge.observation`, `knowledge.memory-store`, client-side redaction, broader `/v2/knowledge/query` sources, project profile `agent-core` | Callers with `context` could request observation and memory-store handoffs. The new profile grants nothing until a project token exists |
| `#23` `c3666b7` | Capability-registry touch plus REA preflight test | Bundled with the REA route below |
| `#24` `93a4a36`, `#26` `8e77ab5` | `POST /v2/rea/route` (scope `route`), allowlist profiles v1/v2, `package-lock.json` | New route for identities that hold `route`. Default `REA_LOCAL_HANDOFF_ENABLED=false`. `mcp.rea` is `PLANNED` and marked `vps_execution: false` |
| `#20` `#25` `#27` `#28` | Audits and memory docs only | No runtime change |

None of these commits change the Jev client timeout or add a retry. The deployed client remains a single 8000 ms attempt.

## Re-check the live pointer

```bash
readlink -f ~/agent-core/current
cat ~/agent-core/current/RELEASE_SHA
curl -sS -m 3 http://127.0.0.1:8787/v1/health
systemctl --user is-active agent-core.service
```

Expected: path ends in `releases/dbe20a5`, SHA `dbe20a5543c07996aafc9f39ceb050007ce79842`, JSON `"version":"0.7.0"`, unit `active`.

Rollback of the **service** (not of this documentation) remains:

```bash
ln -sfn ~/agent-core/releases/01092e2 ~/agent-core/current
systemctl --user restart agent-core.service
```

Do not run that restart to publish documentation. This file does not change the running release.

## External activation state

Live infrastructure verification is documented with raw evidence in `docs/evidence/v2-8/`: OpenRouter/Jev
calls succeed and fail explicitly, Cloudflare TLS/Access/tunnel/rate-limit behave as designed, the
origin stays loopback-only, the browser MCP runtime both transports and executes approved actions, and
rollback (service, config, edge rule, browser runtime) is rehearsed.
