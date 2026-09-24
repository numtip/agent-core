# Agent Core v2 — V2-8 Production Activation Report

Host: `10.1.254.237` (`ubantu24`) · Repo: `numtip/agent-core` · Branch: `main` @ `fca4f8f`
Deployed release: `~/agent-core/releases/fca4f8f` (merged `main`, PR #15) · runtime `0.6.0`
Test window: 2026-09-25 01:42 – 02:30 (+07) · Executor: Hermes Agent

---

## 1. Executive summary

Agent Core v2 (v0.6.0) was built, tested, deployed and exercised live on host 237, then the two
V2-8 follow-ups were completed: the Cloudflare edge rate-limit now covers `/v2/*`, and live
Playwright MCP browser execution is wired into the gateway behind the full policy pipeline with a
kill switch.

| Gate | Result |
|---|---|
| Source | `main` @ `fca4f8f` (PR #14 hardening + PR #15 browser execution merged) |
| Dependency audit (prod) | **0 vulnerabilities** |
| Unit tests | **68/68 PASS** (14 files) |
| TypeScript build | **PASS** |
| Live QA (loopback origin) | **70/70 PASS** (incl. 12 live browser-execution cases) |
| Isolated-instance QA | **17/17 PASS** (dbplant policy, provider failure, kill switch off, MCP down) |
| Supervisor matrix | **10/10 PASS** |
| Playwright MCP transport | **8/8 PASS** (real Chromium navigation + DOM evaluation) |
| Cloudflare edge QA | **7/7 PASS** (normal, auth, burst → 429, recovery, Access unchanged) |
| Benchmark | **18 cases × 3 reps = 54/54 PASS**, p50 2.2 ms, p95 716 ms, context reduction 0.51, cost `NOT_AVAILABLE` |
| Rollback rehearsal | previous release healthy in **0.59 s**, roll-forward **0.59 s**, window **1.21 s**; MCP stop → clean 503 in 54 ms |
| Security invariants | held in every adversarial case (auth, impersonation, policy bypass, SSRF/private targets, prompt injection, dbplant write, production/destructive writes, secret hygiene) |

**Declaration: `AGENT_CORE_V2_PRODUCTION_READY=YES`** — every mandatory acceptance item is verified
with live evidence. Remaining warnings (§12) are recorded open items, not safety failures.

## 2. VPS baseline

| Item | Value |
|---|---|
| Hostname | `ubantu24` (10.1.254.237) |
| OS / kernel | Ubuntu 24.04.4 LTS / 6.8.0-137-generic x86_64 |
| CPU / RAM | 4 vCPU / 7.8 GiB (5.3 GiB available) |
| Disk / inode | `/` 82 GiB, ~56 % used / inodes 15 % |
| Node / git / docker / cloudflared | v22.22.2 / 2.43.0 / 29.7.2 / 2026.8.2 |
| Privileges | user `prinyaroot`; `sudo` needs a password except narrow NOPASSWD rules (cloudflared files, landing script) |

`VPS_BASELINE: PASS`

## 3. Source and deployment

| Item | Value |
|---|---|
| `origin/main` | `fca4f8f48660af9965c938cc3c0955cdf4d3aef7` (merge of PR #15) |
| Deployed tree | `~/agent-core/releases/fca4f8f` (built + tested on `main`) |
| Rollback targets | `~/agent-core/releases/bf08030-h1`, `~/agent-core/releases/188de03` (pre-V2, `0.2.0`) |
| Deployment method | repository-native user-space layout: `~/agent-core/releases/<sha>` + `current` symlink + `systemd --user` `agent-core.service` |
| Service | active, enabled, `Restart=on-failure`, `NoNewPrivileges`, `PrivateTmp`, `Linger=yes` (boot-safe) |
| Origin bind | `127.0.0.1:8787` only |
| Health | `{"status":"ok","service":"agent-core","version":"0.6.0","api_versions":["v1","v2"],"jev_model":"~typesafe/jev-latest","provider_configured":true,"auth_required":true}` |

## 4. CI / build gates

| Gate | Command | Result |
|---|---|---|
| Dependency audit (prod) | `npm audit --omit=dev --audit-level=high` | PASS — 0 vulnerabilities |
| Tests | `npm test` (vitest) | PASS — 14 files, **68 tests** |
| Build | `npm run build` (tsc) | PASS |
| CI | GitHub Actions `test` on PR #14 and PR #15 | PASS (each ~31–34 s) |
| Reproducible install | `npm ci` | NOT POSSIBLE — no lockfile in the repo (warning W1) |

## 5. Configuration validation (no secret values)

| Area | State |
|---|---|
| `OPENROUTER_API_KEY` | CONFIGURED=true (central to Agent Core; no per-project keys) |
| Jev model / endpoint | `~typesafe/jev-latest` · `https://openrouter.ai/api/alpha/decisions` |
| Runtime host/port | `127.0.0.1:8787` |
| Authentication | enabled |
| Project identities | 5 host-side (`52clips`, `attendance-report-generator`, `handbook`, `goffice2026`, `dbplant`); tokens only in `~/.config/agent-core/agent-core.env` (600) |
| Project scopes | handbook + goffice2026 include `browser`; 52clips / attendance / dbplant do **not** |
| Rate limit (app) | 100 req / 60 s per project+scope |
| Rate limit (edge) | 100 req / 10 s per IP+colo for `/control` + `/v1/*` + **`/v2/*`** |
| Audit log | `~/agent-core/logs/audit.jsonl` |
| **`PLAYWRIGHT_MCP_EXECUTION_ENABLED`** | **`true`** on host 237 (kill switch; code default `false`) |
| `PLAYWRIGHT_MCP_ENDPOINT` | `http://127.0.0.1:8791/mcp` (loopback default in config) |
| `PLAYWRIGHT_MCP_TIMEOUT_MS` | `20000` |

## 6. Cloudflare state (edge change completed this round)

| Item | Evidence |
|---|---|
| Tunnel | `98cc1f81-c265-4c44-a61d-5271a2cad897`, local config → `agent.raemanagemju.net` → `http://127.0.0.1:8787` |
| TLS | valid, Google Trust Services WE1, 2026-08-20 → 2026-11-18, `ssl_verify_result=0` |
| Access | `/control` → 302 to `raemanagemju.cloudflareaccess.com`; `Machine API /v1/*` requires a service token (non_identity) → `/v1/*` returns 403 without one |
| Rate-limit rule | `agent-core-edge-volumetric-backstop-100-per-10s-per-ip` — block, 100 req / 10 s per `cf.colo.id + ip.src`, mitigation 10 s; expression now ends with `or starts_with(http.request.uri.path, "/v2/")` |
| Edge change safety | ruleset backed up before the change: `~/agent-core/backups/cloudflare-ratelimit-20260925-021304.json`; applied via `PUT /zones/{zone}/rulesets/phases/http_ratelimit/entrypoint` (PATCH is rejected for token auth: HTTP 405 / code 10405) |
| Origin exposure | unchanged: ports 8787 / 80 / 8097 refused from another LAN host; no new public listener; the MCP runtime binds `127.0.0.1:8791` only |
| Edge QA | 7/7 — see §7 of the live QA report |

## 7. OpenRouter / Jev state

Live calls verified (choice conf 0.84 → `REVIEW`, score conf 0.73, noul conf 0.54 → `FALLBACK`),
provider latency 352–736 ms in live QA and ~324 ms p50 in the benchmark. Failure behaviour is
explicit: unreachable provider + `fallback_result` → 200 `FALLBACK(fallback=true)`; unreachable
provider without fallback → **503 `DECISION_UNAVAILABLE`**.

## 8. Playwright MCP state — transport **and** execution

| Item | State |
|---|---|
| Runtime | `@playwright/mcp` 0.0.82 + Chromium 1246, `~/agent-core/mcp-playwright/` |
| Service | `agent-core-browser-mcp.service` (systemd user), `127.0.0.1:8791`, `MemoryMax=1G`, `CPUQuota=150 %`, `TasksMax=512`, `NoNewPrivileges`, `ProtectSystem=strict`, blocked-origins list, `--allowed-hosts 127.0.0.1:8791,localhost:8791` |
| Transport proof | MCP initialize, 25 tools, real navigation, `document.title="Example Domain"`, loopback/metadata/`file://` refused, no orphan browsers (8/8) |
| Execution path | **live**: `POST /v2/browser/execute` → auth → scope → hard policy → browser control → URL/SSRF guard → injection guard → approval gates → MCP |
| Kill switch | `PLAYWRIGHT_MCP_EXECUTION_ENABLED` (default `false` in code; `true` on host 237). When off: plan evaluated + audited, `executed:false`, reason `MCP_EXECUTION_DISABLED` |
| Failure handling | MCP down → `503 MCP_UNAVAILABLE` within the timeout (no hang, nothing executed) |
| Receipts / audit / metrics | `mcp_*` receipt with endpoint, tool, session id, latency; audit rows `MCP_EXECUTED` / `MCP_TOOL_ERROR` / `MCP_UNAVAILABLE` / `MCP_EXECUTION_DISABLED`; counters `browser_executions`, `browser_execution_blocks`, `browser_execution_disabled`, `browser_execution_unavailable`, `browser_execution_failures` |

Live execution evidence (post-merge, release `fca4f8f`): READ → `EXECUTED executed=true` with MCP
session id and page title; NAVIGATE → `EXECUTED`; localhost/`[::1]`/integer IP/`10.x` → `DENY` in
~4 ms with the transport never called; injection → `HUMAN_REVIEW`; submit → approval required;
destructive → `HUMAN_REVIEW`; missing `browser` scope → 403.

## 9. Project identity and adapter state

| Project | Verified behaviour |
|---|---|
| `52clips` | router/gateway/context/supervisor reachable; `/v2/browser/*` → 403 (no browser scope) |
| `attendance-report-generator` | deterministic-first routing works; browser 403 |
| `handbook` | browser planning **and** live execution (READ/NAVIGATE) with receipts; publish stays human-approved |
| `goffice2026` | browser planning + execution allowed; production write → `APPROVAL_REQUIRED` |
| `dbplant` | no `route` scope → gateway unreachable (403); isolated instance with a temporary route scope: READ contract-only, WRITE → `APPROVAL_REQUIRED DBPLANT_READ_ONLY_DEFAULT`, DESTRUCTIVE → approval, browser capability → 403 |

Adapter YAML contracts parse and are covered by `tests/project-migration.test.ts`; their feature
flags remain declarative (warning W5).

## 10. Security findings

| Finding | Severity | State |
|---|---|---|
| Browser URL guard allowed IPv6 loopback / link-local / ULA / IPv4-mapped / integer / hex IPs | high (SSRF-class) | **FIXED** (PR #14) + regression tests |
| Browser-class capability reachable through `/v2/execute` without the browser scope | medium | **FIXED** (PR #14) |
| Cloudflare edge rate-limit rule did not cover `/v2/*` | medium | **FIXED** this round (edge rule extended, verified with a live burst) |
| Browser execution was `HANDOFF` only (no live transport wiring) | — (acceptance gap) | **CLOSED** this round: live execution behind the full policy pipeline + kill switch |
| `python-urllib/*` user agents refused at the edge (Cloudflare 1010) while curl/CLI UAs succeed | low | OPEN (W3) — mitigation: explicit user agent or Access service token |
| Adapter YAML flags are declarative, not runtime-enforced | low | OPEN (W5) |
| URL guard is literal; DNS names resolving to private addresses are not caught | low | OPEN (W6) |
| `/v1/control-metrics` has no application-level auth (loopback + edge only) | low | OPEN (W7) |

No authentication bypass, no policy bypass, no secret exposure, no unsafe public origin.

## 11. Known warnings

1. **W1** no `package-lock.json` → `npm ci` impossible (reproducibility).
2. **W3** `python-urllib/*` user agents refused at the edge (1010).
3. **W4** no HTTP route for the Supervisor in v0.6.0 (module-level verification only).
4. **W5** adapter YAML feature flags are declarative contracts.
5. **W6** browser URL guard does not resolve DNS (rebinding).
6. **W7** `/v1/control-metrics` unauthenticated on loopback.
7. **W8** `/v2/*` is protected by application-level project tokens plus the edge rate limit, but has no Cloudflare Access application (the change this round was rate limiting, as requested).
8. **W9** stale branch `ops/production-activation` + PR #4 (older lineage) still needs an owner decision.

## 12. Final readiness

```
AGENT_CORE_V2_PRODUCTION_READY=YES
```

Both previous blockers are closed with live evidence:

| Previous blocker | Closure evidence |
|---|---|
| `BLOCKED_CONFIG:EDGE_RATE_LIMIT_V2_COVERAGE` | Edge rule extended to `/v2/`; burst of 160 concurrent requests produced 55 edge 429s after ~105 passed, zero application 429s, recovery after the 10 s window; `/control` and `/v1/*` behaviour unchanged |
| `BLOCKED_RUNTIME:PLAYWRIGHT_MCP_NOT_WIRED` | `/v2/browser/execute` executes READ/NAVIGATE through the live MCP runtime with receipts/audit/metrics, gated by scope, hard policy, SSRF/injection guards and approval rules, with a kill switch and clean failure when the runtime is down |

Acceptance checklist (handoff §40): source == `main`, clean worktree, prod audit acceptable, tests
PASS, build PASS, service stable, restart + rollback verified, v1 compatibility verified, capability
registry / unified router / gateway / context governor verified, supervisor verified (module level),
authentication + scope + hard policy verified, production-write approval + destructive protection
verified, dbplant read-only invariant verified, live OpenRouter/Jev verified, Cloudflare TLS + Access
verified, origin exposure acceptable, edge rate control covering the v2 surface verified, Playwright
MCP transport **and** execution verified, browser domain policy + prompt-injection guard + write
approval verified, project adapters verified, audit/metrics verified, Control Center verified,
benchmark complete (54/54), rollback procedure documented **and rehearsed**.

Decision-support note: Jev was consulted before the merge (`merge-pr` on PR #15 → `approve`,
confidence 0.54, probabilities {approve 0.69, hold 0.30, reject 0.01}) and earlier on the blocked
declaration (`declare_blocked`). Jev advises; Prinya approves.

## 13. Artifacts

- `docs/V2_LIVE_QA_REPORT.md` — item-by-item live QA (70 live + 17 isolated + 10 supervisor + 8 MCP + 7 edge)
- `docs/V2_BENCHMARK_REPORT.md` — 18-case benchmark, metrics, limitations
- `docs/V2_ROLLBACK_RUNBOOK.md` — rollback/emergency procedure, rehearsed (incl. MCP disable path)
- `docs/evidence/v2-8/*.jsonl|json` — raw machine-readable results
- `ops/v2-qa-live.py`, `ops/v2-isolated-qa.py`, `ops/v2-supervisor-qa.mjs`, `ops/v2-browser-mcp-qa.mjs`, `ops/v2-edge-qa.py`, `ops/v2-benchmark.py`
- Backups: `~/agent-core/backups/20260925-014456/` (deployment state), `~/agent-core/backups/cloudflare-ratelimit-20260925-021304.json` (edge rule before the change)
- Rollback rehearsal logs: `~/agent-core/logs/rollback-rehearsal/20260925-020439.txt`, `…20260925-022617.txt`
