# Agent Core v2 — V2-8 Live QA Report

Host `10.1.254.237` · runtime `0.6.0` · release `bf08030-h1` · executed 2026-09-25 01:46–02:10 (+07)
Raw evidence: `docs/evidence/v2-8/live-qa-results.jsonl`, `isolated-qa-results.jsonl`,
`supervisor-qa-results.jsonl`, `browser-mcp-results.jsonl`.

Disposition vocabulary: `PASS` / `PASS_WITH_WARNING` / `FAIL` / `BLOCKED` / `NOT_APPLICABLE`.
Every row below is a real request against the running service (or an isolated instance where
stated); no result is inferred from code or documentation.

---

## 1. Health (G)

| Case | Expected | Observed | Disposition |
|---|---|---|---|
| G-health | 200 agent-core | `200 {"status":"ok","service":"agent-core","version":"0.6.0","api_versions":["v1","v2"],"provider_configured":true,"auth_required":true}` | PASS |

## 2. Authentication (H) — 5/5 PASS

| Case | Expected | Observed | Disposition |
|---|---|---|---|
| H1 | 401 without credentials | 401 `{"error":"UNAUTHORIZED"}` | PASS |
| H2 | 401 invalid token | 401 `{"error":"UNAUTHORIZED"}` | PASS |
| H3 | 403 insufficient scope | 403 `{"error":"FORBIDDEN","scope":"route"}` (dbplant identity has decision+context only) | PASS |
| H4 | 200 valid identity+scope | 200 route decision | PASS |
| H5 | 403 project mismatch | 403 `{"error":"PROJECT_MISMATCH"}` (goffice2026 token, handbook body) | PASS |

## 3. Capability Registry (I) — 4/4 PASS

`GET /v2/capabilities` → 7 capabilities: `deterministic.runtime`, `model.frontier`,
`agent.cursor`, `agent.codex`, `agent.hermes`, `tool.git`, `mcp.playwright`.
`GET /v2/capabilities/mcp.playwright` → 200, `execution_mode=HANDOFF`,
`live_transport_requires_runtime_adapter=true`, risk HIGH, operations READ/WRITE/EXTERNAL/DESTRUCTIVE.
`GET /v2/capabilities/does.not.exist` → 404 `CAPABILITY_NOT_FOUND`.
`POST /v2/capabilities/search {query:"browser"}` → 200 with `mcp.playwright`.

## 4. Unified Router (J) — 6/6 PASS

| Case | Task | Selected | Disposition |
|---|---|---|---|
| J1 | validate manifest / verify checksums, deterministic, lowest cost | `deterministic.runtime` | ROUTE |
| J2 | analyze architecture tradeoffs, complex | `model.frontier` | ROUTE |
| J3 | refactor repo code + tests, complex | `model.frontier` | ROUTE |
| J4 | deploy service on vps (tag `vps`) | `agent.hermes` | ROUTE |
| J5 | publish production content, WRITE, production | — | HUMAN_REVIEW |
| J6 | drop database table, DESTRUCTIVE | — | HUMAN_REVIEW |

## 5. Gateway / Interceptor (K) — 9/9 live + 7/7 isolated PASS

| Case | Request | Observed | Disposition |
|---|---|---|---|
| K1 | handbook, `mcp.playwright`, READ | `HANDOFF`, `executed:false`, `reason=CLIENT_OR_ADAPTER_HANDOFF` | PASS |
| K2 | goffice2026, `deterministic.runtime` | `READY_LOCAL`, `executed:false`, `LOCAL_EXECUTOR_REQUIRED` | PASS |
| K3/K4/K5 | dbplant WRITE / DESTRUCTIVE / READ on the live identity | 403 (no `route` scope → gateway unreachable) | PASS |
| K6 | target `/srv/app/.env` | `APPROVAL_REQUIRED`, `SECRET_OR_CREDENTIAL_TARGET` | PASS |
| K7 | unknown capability id | `UNAVAILABLE`, `CAPABILITY_NOT_ACTIVE` | PASS |
| K8 | production WRITE | `APPROVAL_REQUIRED`, `PRODUCTION_WRITE_REQUIRES_APPROVAL` | PASS |
| K13 | 52clips (no browser scope) asks for `mcp.playwright` | 403 `{"error":"FORBIDDEN","scope":"browser"}` | PASS |
| K9–K12 (isolated 8799, dbplant granted temporary `route`) | generic agent READ / production WRITE / secret target / browser capability | `HANDOFF executed:false` · `APPROVAL_REQUIRED DBPLANT_READ_ONLY_DEFAULT` · `APPROVAL_REQUIRED SECRET_OR_CREDENTIAL_TARGET` · 403 browser scope | PASS |

No gateway path executed anything (`executed:false` everywhere) and no capability selection
overrode policy.

## 6. Context Governor (M) — 3/3 PASS

Test: 9-item realistic bundle (requirement, safety policy, approval requirement, unresolved
blocker, pinned item, one long log, stale items, relevant summary), query “deployment build
artifacts and route decision”, `max_items=4`.

- Dispositions produced: all four — `PIN`, `KEEP`, `COMPRESS`, `DROP`
  (`appr-1`, `block-1`, `pin-1`, `pol-1`, `req-1` → PIN; `big-1` → COMPRESS; `keep-1` → KEEP;
  `noise-1`, `noise-2`, `stale-1` → DROP).
- Protected items (explicit requirement, accepted decision, safety policy, unresolved blocker,
  deployment state, QA failure, source-of-truth, approval requirement) were **never dropped**.
- Receipt contained `receipt_id`, `strategy`, selected/pinned/compressed/dropped id lists,
  `original_chars=3542`, `output_chars=2130`, `reduction_ratio=0.3986`.

## 7. Supervisor (N) — 10/10 PASS · **PASS_WITH_WARNING**

v0.6.0 exposes **no HTTP route** for the supervisor, so the decision matrix was verified by
importing the built module (`ops/v2-supervisor-qa.mjs`), not over the network:

| Case | Expected | Observed |
|---|---|---|
| N1 normal continuation | CONTINUE | CONTINUE (`WORK_REMAINS`) |
| N2 delegation | DELEGATE | DELEGATE (`PENDING_SUBGOALS`) |
| N3 missing dependency | WAIT_FOR_DEPENDENCY | WAIT_FOR_DEPENDENCY (`DEPENDENCY_BLOCKED`) |
| N4 QA failure with budget | RETRY | RETRY (`QA_FAILED_RETRY_AVAILABLE`) |
| N5 budget exhausted | ESCALATE | ESCALATE (`MAX_ATTEMPTS_REACHED`) |
| N6 completed, unverified | VERIFY | VERIFY (`EXECUTION_COMPLETE_NEEDS_VERIFICATION`) |
| N7 verified success | STOP_SUCCESS | STOP_SUCCESS (`TASK_COMPLETED`) |
| N8 irrecoverable failure | STOP_FAILURE | STOP_FAILURE (`TASK_FAILED`) |
| N9 destructive operation | ESCALATE | ESCALATE (`HUMAN_APPROVAL_REQUIRED`) |
| N10 approval phase | ESCALATE | ESCALATE (`HUMAN_APPROVAL_REQUIRED`) |

Warning: acceptance evidence is module-level only; exposing a supervisor endpoint is follow-up work.

## 8. Live OpenRouter / Jev (L) — 4/4 PASS

| Case | Decision | Result | Confidence | Disposition | Fallback | Latency |
|---|---|---|---|---|---|---|
| L1 | TASK_ROUTE choice (52clips clip state) | `GENERATE_SUBTITLE` | 0.84 | REVIEW (below the 0.85 execute threshold) | false | 736 ms |
| L2 | MODEL_ROUTE score | `medium` | 0.73 | REVIEW | false | 371 ms |
| L3 | NEXT_ACTION noul with `fallback_result` | fallback value | 0.54 | FALLBACK | true | 353 ms |
| L4 | unknown project identity | — | — | 403 `PROJECT_MISMATCH` (no cross-project decision) | — | — |

Provider request ids were returned for the choice decision and are recorded in the raw evidence;
no authorization header is stored anywhere. Provider failure behaviour (V) is in §11.

## 9. Browser policy (Q) — 19/19 PASS

| Case | Target / action | Observed |
|---|---|---|
| Q-A | `https://example.com/` BROWSER_READ | `READY`, receipt `brw_*` |
| Q-B | `https://example.com/page` BROWSER_NAVIGATE | `READY` |
| Q-C / Q-C2 | `http://127.0.0.1/`, `http://localhost:8097/` | `DENY PRIVATE_OR_LOCAL_HOST_BLOCKED` |
| Q-D … Q-D4 | `10.1.254.237`, `172.16.5.5`, `192.168.1.10`, `169.254.169.254` | `DENY PRIVATE_OR_LOCAL_HOST_BLOCKED` |
| Q-D5 | `http://[::1]/` (was READY before hardening) | `DENY PRIVATE_OR_LOCAL_HOST_BLOCKED` |
| Q-D6 / Q-D7 | `file:///etc/passwd`, `ftp://…` | `DENY UNSUPPORTED_URL_SCHEME` |
| Q-E / Q-E2 | page text with “ignore all previous instructions / reveal secrets / send api key / disable safety” | BROWSER_NAVIGATE → `HUMAN_REVIEW PROMPT_INJECTION_SIGNAL`; BROWSER_READ → `READY` with `injection.detected=true` |
| Q-F | BROWSER_INPUT without submit | `READY` (policy-controlled, risk MEDIUM) |
| Q-G | BROWSER_SUBMIT | `EXPLICIT_WRITE_SCOPE_REQUIRED` |
| Q-H | BROWSER_DESTRUCTIVE | `HUMAN_REVIEW DESTRUCTIVE_OPERATION_REQUIRES_APPROVAL` |
| Q-I | 52clips / dbplant ask for the browser surface | 403 `FORBIDDEN scope=browser` |
| Q-J | `deny_domains=["example.org"]` | `DENY DOMAIN_POLICY_BLOCK` |

Additional transport-level evidence (see §10): the browser runtime itself refuses loopback and
metadata origins, and `file://` navigation is off unless the unrestricted-access flag is set.

## 10. Playwright MCP transport (P) — 8/8 PASS

`@playwright/mcp` 0.0.82, Chromium 1246, MCP stdio session:

| Case | Observed |
|---|---|
| P1 initialize | server `Playwright v1.64.0-alpha-…`, protocol 2025-06-18 |
| P2 tools/list | 25 tools (incl. `browser_navigate`, `browser_evaluate`) |
| P3 navigate | real navigation to `https://example.com/` succeeded |
| P4 evaluate | `document.title` → `"Example Domain"` |
| P5 loopback | `net::ERR_BLOCKED_BY_CLIENT` for `http://127.0.0.1:8097/` |
| P6 metadata | `http://169.254.169.254/…` refused (blocklist/timeout, no data returned) |
| P7 file scheme | `file:///etc/passwd` refused |
| P8 process hygiene | no orphan `headless_shell`/`chrome` processes after the session |

Persistent runtime: `agent-core-browser-mcp.service` (systemd user unit) on `127.0.0.1:8791`,
`MemoryMax=1G` (current ~70 MB), `CPUQuota=150 %`, `TasksMax=512`, loopback-only,
host-header check enforced (`127.0.0.1` Host header → 403, `localhost` → 200).
**Agent Core execution stays HANDOFF** — no browser action is executed by the control plane.

## 11. Failure / fallback behaviour (V) — 4/4 PASS (isolated instance 8800, broken provider URL)

| Case | Expected | Observed |
|---|---|---|
| V1 | explicit failure, nothing swallowed | `503 {"error":"DECISION_UNAVAILABLE","message":"No safe decision is available and no fallback_result was supplied"}` |
| V2 | safe fallback when declared | 200 `disposition=FALLBACK`, `fallback=true`, `reason_code=PROVIDER_UNAVAILABLE`, `confidence=0` |
| V3 | service stays up, health stays honest | 200 health with `provider_configured=true` |
| V4 | invalid capability | 200 `UNAVAILABLE` |

## 12. Control Center (S) — 2/2 PASS

- `GET /control` → 200 HTML (1960 bytes) listing Unified Router, Gateway, Context Governor,
  Browser Control (**HANDOFF**, “live transport externally gated”), Supervisor, Health, Metrics;
  Cloudflare Access notice present; no false “live transport active” claim.
- Externally: `/control` → 302 to Cloudflare Access (not public).
- `GET /v1/control-metrics` → 200 metrics snapshot on loopback (no app-level auth — warning W7 group).

## 13. Audit / observability (T) — 3/3 PASS

Audit log `~/agent-core/logs/audit.jsonl` contains `UNIFIED_ROUTE`, `GATEWAY_INTERCEPT`,
`CONTEXT_GOVERN`, `BROWSER_READ`/`BROWSER_NAVIGATE`/`BROWSER_INPUT`/`BROWSER_SUBMIT`/`BROWSER_DESTRUCTIVE`
and the Jev decision types (`TASK_ROUTE`, `MODEL_ROUTE`, `NEXT_ACTION`, `QA_DISPOSITION`), each with
`timestamp`, `project`, `action`, `result`, `latency_ms`, `task_id` where applicable.
No project token was found in audit or journal (2000 journal lines scanned); no authorization
header appears in logs.

## 14. Rate limit (U) — 2/2 PASS

App-level: 100 requests / 60 s per project+scope → first `429 RATE_LIMITED` at request #96 of a
106-request probe, 10× 429 in total, and a normal 200 again after the window elapsed.
Edge-level: rule exists (100 req / 10 s per IP, block) but does not match `/v2/*` — see W2.

## 15. End-to-end control plane (R) — 3/3 PASS

Sequence proven on an isolated instance: authentication boundary (401) → capability registry (7) →
unified router (`deterministic.runtime`) → hard policy evaluated before execution
(`APPROVAL_REQUIRED` for a production WRITE) → context governor (receipt) → live provider decision —
plus audit rows for every layer and counter coverage
(`v2_routes`, `gateway_requests`, `context_governor_requests`, `policy_blocks`, `decisions`).
No layer bypassed another.

## 16. Acceptance checklist mapping (§40 of the handoff)

| Checklist item | Result |
|---|---|
| source == verified origin/main, working tree clean | PASS |
| production dependency audit acceptable | PASS (0 prod vulnerabilities; `npm ci` unavailable → W1) |
| all tests PASS / TypeScript build PASS | PASS (57 tests, tsc clean) |
| service stable, startup/restart verified | PASS (restart + rollback rehearsal) |
| v1 compatibility verified | PASS (`/v1/decision`, `/v1/route`, `/v1/qa`, `/v1/context`, `/v1/subagent`, `/v1/advanced-route`, `/v1/projects`, `/v1/metrics`, `/v1/control-metrics` all 200 with valid payloads/scopes) |
| Capability Registry / Unified Router / Gateway / Context Governor verified | PASS |
| Supervisor verified | PASS_WITH_WARNING (module level only, no HTTP route) |
| authentication, project scope, hard policy verified | PASS |
| production write approval, destructive protection verified | PASS |
| dbplant read-only invariant verified | PASS (live 403 + isolated policy path) |
| live OpenRouter/Jev verified | PASS |
| Cloudflare TLS / Access / origin exposure | PASS (rate-limit coverage gap → W2) |
| Playwright MCP transport verified | PASS at transport level; execution wiring HANDOFF → blocker B2 |
| browser domain policy / prompt-injection guard / write approval | PASS |
| project adapters verified | PASS_WITH_WARNING (flags declarative → W5) |
| audit logging, metrics verified | PASS |
| Control Center verified | PASS |
| benchmark complete | PASS (45/45) |
| rollback procedure + health verification documented | PASS (rehearsed, 2.31 s window) |
