# Agent Core v2 — V2-8 Live QA Report

Host `10.1.254.237` · runtime `0.6.0` · release `4246c0a` (merged `main`; live suite re-run on this exact release) · executed 2026-09-25 01:46–02:31 (+07)
Raw evidence (`docs/evidence/v2-8/`): `v2-qa-live.jsonl` (70), `v2-qa-isolated.jsonl` (17),
`v2-supervisor-qa.jsonl` (20), `v2-browser-mcp.jsonl` (8), `v2-edge-qa.jsonl` (7),
`v2-benchmark.jsonl` (54).

Dispositions: `PASS` / `PASS_WITH_WARNING` / `FAIL` / `BLOCKED` / `NOT_APPLICABLE`. Every row is a
real request against the running service (or an isolated instance where stated).

---

## 1. Summary of suites

| Suite | Cases | Pass | Fail |
|---|---|---|---|
| Live QA on the loopback origin (G, H, I, J, K, L, M, Q, QX, S, U, T) | 70 | 70 | 0 |
| Isolated instances (K dbplant, R end-to-end, V failure paths, V5–V7) | 17 | 17 | 0 |
| Supervisor matrix (module level) | 10 | 10 | 0 |
| Playwright MCP transport | 8 | 8 | 0 |
| Cloudflare edge (public hostname) | 7 | 7 | 0 |
| **Total** | **112** | **112** | **0** |

## 2. Health (G)

`200 {"status":"ok","service":"agent-core","version":"0.6.0","api_versions":["v1","v2"],"provider_configured":true,"auth_required":true}` → PASS

## 3. Authentication (H) — 5/5 PASS

| Case | Observed |
|---|---|
| H1 no credentials | 401 `UNAUTHORIZED` |
| H2 invalid token | 401 `UNAUTHORIZED` |
| H3 valid identity, insufficient scope (dbplant has no `route`) | 403 `FORBIDDEN scope=route` |
| H4 valid identity + scope | 200 route decision |
| H5 identity/body project mismatch | 403 `PROJECT_MISMATCH` |

## 4. Capability Registry (I) — 4/4 PASS

7 capabilities (`deterministic.runtime`, `model.frontier`, `agent.cursor`, `agent.codex`,
`agent.hermes`, `tool.git`, `mcp.playwright`); `mcp.playwright` → `execution_mode=HANDOFF`,
`live_transport_requires_runtime_adapter=true`, risk HIGH; unknown id → 404; search by tag works.

## 5. Unified Router (J) — 6/6 PASS

`deterministic.runtime` (deterministic), `model.frontier` (complex reasoning), `model.frontier`
(coding), `agent.hermes` (vps tag), production WRITE → `HUMAN_REVIEW`, DESTRUCTIVE → `HUMAN_REVIEW`.

## 6. Gateway / Interceptor (K) — 9/9 live + 7/7 isolated PASS

`mcp.playwright` → `HANDOFF executed:false`; `deterministic.runtime` → `READY_LOCAL executed:false`;
dbplant live identity → 403 (gateway unreachable, no `route` scope); secret target →
`APPROVAL_REQUIRED SECRET_OR_CREDENTIAL_TARGET`; unknown capability → `UNAVAILABLE`; production write
→ `APPROVAL_REQUIRED PRODUCTION_WRITE_REQUIRES_APPROVAL`; browser capability without browser scope →
403. Isolated dbplant path: READ contract-only, WRITE → `DBPLANT_READ_ONLY_DEFAULT`, production WRITE
→ approval, secret target → approval, browser capability → 403.

## 7. Context Governor (M) — 3/3 PASS

All four dispositions produced (PIN / KEEP / COMPRESS / DROP); protected items (explicit
requirement, accepted decision, safety policy, unresolved blocker, deployment state, QA failure,
source-of-truth, approval requirement) are **never dropped**; receipt carries
selected/pinned/compressed/dropped ids, `original_chars=3542`, `output_chars=2130`,
`reduction_ratio=0.3986` (0.5105 in the benchmark's context-heavy case).

## 8. Supervisor (N) — 10/10 PASS · PASS_WITH_WARNING

No HTTP route exists in v0.6.0, so the matrix is verified by importing the built module:
CONTINUE, DELEGATE, WAIT_FOR_DEPENDENCY, RETRY, ESCALATE (two paths: destructive and retry-budget
exhausted), VERIFY, STOP_SUCCESS, STOP_FAILURE, plus approval-phase escalation.

## 9. Live OpenRouter / Jev (L) — 4/4 PASS

| Case | Result | Confidence | Disposition | Fallback | Latency |
|---|---|---|---|---|---|
| L1 choice (52clips clip state) | `GENERATE_SUBTITLE` | 0.84 | REVIEW (below the 0.85 execute threshold) | false | 736 ms |
| L2 score | `medium` | 0.73 | REVIEW | false | 371 ms |
| L3 noul with `fallback_result` | fallback value | 0.54 | FALLBACK | true | 353 ms |
| L4 unknown project identity | — | — | 403 PROJECT_MISMATCH | — | — |

## 10. Browser policy (Q) — 19/19 PASS

localhost / `127.0.0.1` / `10.x` / `172.16.x` / `192.168.x` / `169.254.169.254` / `[::1]` → `DENY
PRIVATE_OR_LOCAL_HOST_BLOCKED`; `file://` and `ftp://` → `UNSUPPORTED_URL_SCHEME`; injection text →
`HUMAN_REVIEW PROMPT_INJECTION_SIGNAL` (READ keeps `injection.detected=true`); BROWSER_INPUT →
policy-controlled `READY`; BROWSER_SUBMIT/EXTERNAL_WRITE → `EXPLICIT_WRITE_SCOPE_REQUIRED`;
BROWSER_DESTRUCTIVE → `HUMAN_REVIEW`; projects without `browser` scope → 403; `deny_domains` → `DENY
DOMAIN_POLICY_BLOCK`.

## 11. Live browser execution through MCP (QX) — 12/12 PASS

| Case | Expected | Observed |
|---|---|---|
| QX-1 READ | executed through MCP | 200 `EXECUTED executed=true`, MCP session id, page title `Example Domain` |
| QX-2 NAVIGATE | executed through MCP | 200 `EXECUTED executed=true` |
| QX-3 receipt | `mcp_*` receipt + session | receipt id + `mcp.session_id` present |
| QX-4 `52clips` (no browser scope) | 403 | 403 `FORBIDDEN scope=browser` |
| QX-5 `dbplant` | 403, read-only preserved | 403 |
| QX-6 localhost | `DENY`, nothing executed | `DENY` in ~4 ms, transport untouched |
| QX-7 `[::1]` | `DENY` | `DENY` |
| QX-8 integer IP (`2130706433`) | `DENY` | `DENY` |
| QX-9 private `10.1.254.237` | `DENY` | `DENY` |
| QX-10 prompt injection | no execution | `HUMAN_REVIEW PROMPT_INJECTION_SIGNAL`, `executed:false` |
| QX-11 submit | approval required | `EXPLICIT_WRITE_SCOPE_REQUIRED`, `executed:false` |
| QX-12 destructive | human review | `HUMAN_REVIEW`, `executed:false` |

## 12. Playwright MCP transport (P) — 8/8 PASS

initialize (Playwright `1.64.0-alpha-…`, protocol 2025-06-18) · tools/list 25 tools · real navigation
to `example.com` · `document.title` = `Example Domain` · loopback `net::ERR_BLOCKED_BY_CLIENT` ·
metadata endpoint refused · `file:///etc/passwd` refused · no orphan browser processes.
Persistent runtime: `agent-core-browser-mcp.service` on `127.0.0.1:8791`, `MemoryMax=1G`
(~70 MB used), `CPUQuota=150 %`, `TasksMax=512`, host-header allowlist enforced.

## 13. Failure / fallback behaviour (V) — 7/7 PASS (isolated instances)

| Case | Instance | Observed |
|---|---|---|
| V1 provider unreachable, no fallback | 8800 | 503 `DECISION_UNAVAILABLE` (explicit, nothing swallowed) |
| V2 provider unreachable + fallback | 8800 | 200 `FALLBACK(fallback=true)`, `reason_code=PROVIDER_UNAVAILABLE` |
| V3 service stays healthy | 8800 | 200 health, `provider_configured=true` |
| V4 invalid capability | 8800 | 200 `UNAVAILABLE` |
| V5 kill switch off | 8801 | 200 `READY executed=false reason=MCP_EXECUTION_DISABLED` (no live execution) |
| V6 MCP runtime unreachable | 8802 | 503 `MCP_UNAVAILABLE` in ~54 ms (bounded, no hang, nothing executed) |
| V7 dbplant write after the browser work | 8799 | `APPROVAL_REQUIRED DBPLANT_READ_ONLY_DEFAULT` (invariant intact) |

## 14. Cloudflare edge (O2) — 7/7 PASS

| Case | Expected | Observed |
|---|---|---|
| O2-1 normal authenticated machine traffic | 200 | 200 (~257 ms, through the edge) |
| O2-2 unauthenticated | 401 from the application, not masked | 401 `UNAUTHORIZED` |
| O2-3 `/v1/health` | 200 (excluded from the rule) | 200 |
| O2-4 burst on `/v2/*` | edge 429 above 100 req / 10 s per IP | 160 concurrent requests (24 workers, 1.4 s): **55 edge 429**, 105 OK, **0 application 429** |
| O2-5 recovery | 200 after the mitigation window | 200 |
| O2-6 `/control` | still Access-protected | 302 → `raemanagemju.cloudflareaccess.com` |
| O2-7 `/v1/*` | unchanged Access enforcement | 403 without an Access service token |

## 15. Control Center (S) — 2/2 PASS

`/control` lists all v2 modules with Browser Control shown as `HANDOFF` and no false "live transport"
claim; externally 302 behind Cloudflare Access; `/v1/control-metrics` returns 200 on loopback
(no app-level auth — edge/loopback protected only).

## 16. Audit / observability (T) — 3/3 PASS

Audit log (1,257 rows) contains `UNIFIED_ROUTE`, `GATEWAY_INTERCEPT`, `CONTEXT_GOVERN`,
`BROWSER_READ`/`NAVIGATE`/`INPUT`/`SUBMIT`/`DESTRUCTIVE`, Jev decision types, and the new execution
outcomes — observed in the final round: `MCP_EXECUTED` 9, `DENY` 14, `READY` 10, `HUMAN_REVIEW` 4,
`EXPLICIT_WRITE_SCOPE_REQUIRED` 2, `MCP_UNAVAILABLE` 1. No project token or authorization header
appears in the audit log or in 3,000 journal lines.

## 17. Rate limit (U) — 2/2 PASS

Application: first `429 RATE_LIMITED` at request #96 of a 106-request probe, then 200 again after the
window. Edge: see O2-4 (same rule now covers `/v2/*`, `/v1/*` and `/control`).

## 18. End-to-end control plane (R) — 3/3 PASS

auth boundary → capability registry → unified router → hard policy before execution →
context governor → provider decision → audit rows for each layer → metric counters
(`v2_routes`, `gateway_requests`, `context_governor_requests`, `policy_blocks`, `decisions`,
plus the browser execution counters). No layer bypassed policy.

## 19. Acceptance checklist mapping (handoff §40)

| Item | Result |
|---|---|
| source == verified `main`, clean worktree | PASS (`fca4f8f`) |
| prod dependency audit acceptable | PASS (0 prod vulnerabilities; `npm ci` unavailable → W1) |
| all tests PASS / build PASS | PASS (68 tests, tsc clean) |
| service stable, startup/restart verified | PASS |
| v1 compatibility verified | PASS (9 v1 endpoints 200 with valid payloads/scopes) |
| Capability Registry / Router / Gateway / Context Governor | PASS |
| Supervisor | PASS_WITH_WARNING (module level; no HTTP route) |
| authentication / project scope / hard policy | PASS |
| production write approval + destructive protection | PASS |
| dbplant read-only invariant | PASS (live 403 + isolated policy path + re-check after the browser work) |
| live OpenRouter/Jev | PASS |
| Cloudflare TLS / Access / origin exposure | PASS |
| Cloudflare rate control for the v2 surface | **PASS (new)** — edge burst QA |
| Playwright MCP transport | PASS |
| browser execution through the gateway | **PASS (new)** — 12 live cases, kill switch, receipts, clean failure |
| browser domain policy / injection guard / write approval | PASS |
| project adapters | PASS_WITH_WARNING (flags declarative → W5) |
| audit logging / metrics | PASS |
| Control Center | PASS |
| benchmark complete | PASS (54/54) |
| rollback procedure + health verification | PASS (rehearsed twice, incl. MCP disable path) |
