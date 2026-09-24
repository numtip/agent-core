# Agent Core v2 — V2-8 Production Activation Report

Host: `10.1.254.237` (`ubantu24`) · Repo: `numtip/agent-core` · Branch: `main` @ `bf08030`
Deployed release: `~/agent-core/releases/bf08030-h1` (= `bf08030` + two hardening commits, PR pending)
Test window: 2026-09-25 01:42 – 02:10 (+07) · Executor: Hermes Agent

---

## 1. Executive summary

Agent Core v2 (v0.6.0) was built, tested, deployed and exercised live on host 237. Every
control-plane layer of the V2 handoff (Capability Registry, Unified Router, Gateway/Interceptor,
Context Governor, Supervisor, Browser Control, Cloudflare entry, live OpenRouter/Jev) was
verified with real requests against the running service, not from repository claims.

- Local gates: production dependency audit `0 vulnerabilities`, **57/57 unit tests**, TypeScript build PASS.
- Live QA: **58/58 live cases**, **14/14 isolated-instance cases**, **10/10 supervisor cases**, **8/8 Playwright MCP transport cases**.
- Benchmark: **45/45 (BENCH-01 … BENCH-15 × 3 reps)**, p50 2.8 ms, p95 353 ms (dominated by the live Jev call).
- Security invariants held in every attempted adversarial case (auth, impersonation, policy bypass, SSRF, prompt injection, dbplant write, production/destructive writes).
- Rollback rehearsed on production: previous release `188de03` came up healthy in 1.67 s; roll-forward in 0.61 s; total switch window 2.31 s.

**Declaration: `AGENT_CORE_V2_PRODUCTION_READY=BLOCKED`** — not because of a safety failure, but
because two acceptance items are not fully satisfied (edge rate-limit coverage of the `/v2/*`
surface, and the fact that the browser MCP runtime is proven but deliberately not wired into the
gateway). Details in §12.

---

## 2. VPS baseline

| Item | Value |
|---|---|
| Hostname | `ubantu24` (10.1.254.237) |
| OS / kernel | Ubuntu 24.04.4 LTS / 6.8.0-137-generic x86_64 |
| CPU / RAM | 4 vCPU / 7.8 GiB total, 5.3 GiB available |
| Disk / inode | `/` 82 GiB, 55 % used / inodes 15 % used |
| Timezone / time | +07 · 2026-09-25 02:0x |
| Uptime | 40 days |
| Node / npm / git / docker / cloudflared | v22.22.2 / 10.x / 2.43.0 / 29.7.2 / 2026.8.2 |
| Privileges | normal user `prinyaroot`; `sudo` requires a password (NOPASSWD only for specific `cloudflared` / landing-script commands) |

`VPS_BASELINE: PASS` — resources sufficient, no disk or inode pressure, no unexpected public listener.

## 3. Source and deployment

| Item | Value |
|---|---|
| `origin/main` | `bf0803000ff7f2d3254cc8dbbf6ebc5aabd0980a` (2026-09-25), package version `0.6.0` |
| Deployed tree | `~/agent-core/releases/bf08030-h1` (main + browser-policy hardening + gateway browser-scope enforcement) |
| Previous release | `~/agent-core/releases/188de03` (v0.2.0, pre-V2) — kept as the rollback target |
| Older release | `~/agent-core/releases/9d2e9a9` |
| Working tree | clean worktree for V2-8 work; the pre-existing branch `ops/production-activation` (`f09c393`, PR #4) is stale lineage and was **not** used |
| Deployment method | repository-native user-space layout: `~/agent-core/releases/<sha>` + `current` symlink + `systemd --user` unit `agent-core.service` (documented in `ops/activate-user-space.sh`) |
| Service | `agent-core.service` active, enabled, `Restart=on-failure`, `NoNewPrivileges`, `PrivateTmp`, user `linger=yes` (boot-safe) |
| Origin bind | `127.0.0.1:8787` only |
| Health | `{"status":"ok","service":"agent-core","version":"0.6.0","api_versions":["v1","v2"],"jev_model":"~typesafe/jev-latest","provider_configured":true,"auth_required":true}` |

## 4. CI / build gates

| Gate | Command | Result |
|---|---|---|
| Dependency audit (prod) | `npm audit --omit=dev --audit-level=high` | **PASS** — 0 vulnerabilities |
| Tests | `npm test` (vitest) | **PASS** — 13 files, 57 tests |
| Build | `npm run build` (tsc) | **PASS** |
| Reproducible install | `npm ci` | **NOT POSSIBLE** — no `package-lock.json` committed in `main`; used `npm install` → documented warning |

## 5. Configuration validation (no secret values printed)

| Configuration area | State |
|---|---|
| `OPENROUTER_API_KEY` | CONFIGURED=true |
| `OPENROUTER_DECISIONS_URL` | `https://openrouter.ai/api/alpha/decisions` (central, Agent Core only) |
| Jev model | `~typesafe/jev-latest` (fixed in code) |
| Runtime host/port | `127.0.0.1:8787` |
| Authentication | enabled (`AGENT_CORE_AUTH_REQUIRED=true`) |
| Project identities | 5 provisioned host-side (`52clips`, `attendance-report-generator`, `handbook`, `goffice2026`, `dbplant`); tokens 64-hex, stored only in `~/.config/agent-core/agent-core.env` (mode 600) |
| Project scopes | `52clips` decision/route/qa/context/metrics · `attendance-report-generator` decision/route/qa/context · `handbook` decision/route/qa/context/**browser** · `goffice2026` decision/route/qa/context/metrics/**browser** · `dbplant` decision/context |
| Rate limit | `AGENT_CORE_RATE_LIMIT_MAX=100` per `AGENT_CORE_RATE_LIMIT_WINDOW_MS=60000` per project+scope |
| Audit logging | `~/agent-core/logs/audit.jsonl` |
| Cloudflare tunnel | local config `/etc/cloudflared/config.yml`, tunnel `98cc1f81-c265-4c44-a61d-5271a2cad897` |
| Browser scope / domain policy | `browser` scope for `handbook` + `goffice2026` only; private/loopback/unsupported schemes denied by policy |

Changes made during V2-8 (host-side, not in Git): `handbook` and `goffice2026` gained the
`browser` scope (matching their adapter contracts); no scope was widened for `52clips`,
`attendance-report-generator` or `dbplant`.

## 6. Cloudflare state

| Item | Evidence |
|---|---|
| Tunnel | `cloudflared.service` active 1 d 12 h, `agent.raemanagemju.net → http://127.0.0.1:8787` (local config-managed ingress) |
| DNS / TLS | external HTTPS 200 from outside the LAN; certificate CN `raemanagemju.net`, issuer Google Trust Services WE1, valid 2026-08-20 → 2026-11-18, `ssl_verify_result=0` |
| Access | `/control` → 302 to `raemanagemju.cloudflareaccess.com` (app "Agent Core — Human Control Center"); apps also exist for "Machine API `/v1/*`", "Control Metrics", "Health Probe" |
| Origin exposure | **not exposed**: ports 8787 / 80 / 8097 refused from another LAN host (`vps190`), public path only through the tunnel |
| Rate control | edge rule `agent-core-edge-volumetric-backstop-100-per-10s-per-ip` (block, 100 req / 10 s per colo+IP) matching `/control` and `/v1/*` paths — **does not match `/v2/*`** |
| Machine path through the edge | `POST https://agent.raemanagemju.net/v2/route` with a project identity → 200 `deterministic.runtime`; unauthenticated → 401 |

## 7. OpenRouter / Jev state

Central credential, live calls verified (see `docs/V2_LIVE_QA_REPORT.md` §8): choice decision
(conf 0.84 → REVIEW), score decision (conf 0.73), noul decision (conf 0.54 → FALLBACK),
provider latency 352–736 ms, provider request ids returned. Failure handling is explicit:
unreachable provider + `fallback_result` → 200 `FALLBACK(fallback=true)`; unreachable provider
without fallback → **503 `DECISION_UNAVAILABLE`** (never silently swallowed).

## 8. Playwright MCP state

`@playwright/mcp` 0.0.82 with Chromium 1246 installed under `~/agent-core/mcp-playwright`,
running as a systemd user unit `agent-core-browser-mcp.service` on **127.0.0.1:8791** with
`MemoryMax=1G`, `CPUQuota=150 %`, `TasksMax=512`, `NoNewPrivileges`, `ProtectSystem=strict`,
and a transport-level origin blocklist. Live MCP transport proven (initialize, 25 tools, real
navigation, DOM evaluation, loopback/metadata/file refusals, no orphan browsers).

**Execution is still `HANDOFF`**: Agent Core returns a policy-checked execution contract with
`executed:false` for every browser action; the gateway does not drive the MCP runtime. This is the
V2-2 design (no impersonation of external agents), and it is reported as an open item rather than
as "live browser execution".

## 9. Project identity and adapter state

| Project | Runtime behaviour verified |
|---|---|
| `52clips` | router/gateway/context/supervisor reachable; browser scope absent → `/v2/browser/plan` 403 and browser-class capability 403 |
| `attendance-report-generator` | deterministic-first routing works; browser 403 |
| `handbook` | router/gateway/context + browser planning (READY with receipt); publish remains human approval |
| `goffice2026` | router/gateway/context + browser planning; production write → APPROVAL_REQUIRED |
| `dbplant` | identity has no `route` scope → gateway unreachable (403); with a temporary route scope on an isolated instance: READ contract-only, WRITE/DESTRUCTIVE/secret-target → APPROVAL_REQUIRED, browser capability → 403 |

The five adapter YAML contracts parse and are covered by `tests/project-migration.test.ts`; their
feature flags are declarative (see warning W5).

## 10. Security findings

| Finding | Severity | State |
|---|---|---|
| IPv6 loopback / link-local / ULA / IPv4-mapped / decimal-IP / hex-IP browser targets were **not** blocked by the URL guard (`http://[::1]/` returned READY) | high (SSRF-class) | **FIXED** in this change set (`src/browser-control.ts`) with unit tests + live re-verification |
| A browser-class capability (`mcp.playwright`) could be requested through `/v2/execute` by a project **without** the `browser` scope | medium (capability availability outranking project scope) | **FIXED** in this change set (`src/app.ts`, `tests/v2-browser-scope.test.ts`) |
| Edge rate-limit rule does not cover `/v2/*`; no Access app covers `/v2/*` | medium | OPEN — requires a Cloudflare change (edge change affects the shared zone, needs owner approval) |
| Requests with `User-Agent: python-urllib/3.x` are refused by the edge (Cloudflare `error code 1010`) while `curl`/CLI UAs succeed | low | OPEN — affects Python project clients; mitigation: explicit UA or Access service token |
| Adapter YAML flags (e.g. `dbplant.gateway_execute: false`) are not consulted at runtime | low | OPEN — declarative contract only |
| URL-level guard cannot catch DNS names resolving to private addresses (rebinding) | low | OPEN — recommended follow-up |
| `/v1/control-metrics` has no application-level auth (loopback + edge-protected only) | low | OPEN — matches the existing design of the Control Center |

No authentication bypass, no policy bypass, no secret exposure, no unsafe public origin.

## 11. Known warnings

1. **W1** `npm ci` impossible — no lockfile committed (release reproducibility gap).
2. **W2** Edge volumetric backstop and Access application cover `/v1/*` + `/control` but not `/v2/*`.
3. **W3** Python-urllib user agents are refused at the edge (1010).
4. **W4** No HTTP route for the Supervisor in v0.6.0 (verified at module level only).
5. **W5** Adapter YAML feature flags are declarative, not enforced by the runtime.
6. **W6** Browser policy is URL-literal; DNS-resolved private addresses are not covered.
7. **W7** Playwright MCP runtime exists but is not wired into gateway execution (HANDOFF by design).
8. **W8** Stale branch `ops/production-activation` + open PR #4 (older lineage) — needs an owner decision to close/replace.

## 12. Blockers and final readiness

```
AGENT_CORE_V2_PRODUCTION_READY=BLOCKED
```

| Blocker | Why | What closes it |
|---|---|---|
| `BLOCKED_CONFIG:EDGE_RATE_LIMIT_V2_COVERAGE` | The V2 surface (`/v2/*`) is protected only by application-level project tokens; the Cloudflare volumetric backstop rule does not match those paths and no Access application covers them. Rate-limiting the new surface is an acceptance item. | Extend the zone rate-limit expression to include `/v2/`, or add an Access application for `/v2/*` (owner-authorized Cloudflare change). |
| `BLOCKED_RUNTIME:PLAYWRIGHT_MCP_NOT_WIRED` | The browser MCP runtime is live and proven, but Agent Core never executes through it (`executed:false`, `HANDOFF`). Per the handoff rule "do not call HANDOFF-only transport live", the browser execution acceptance item is only half-met. | Either wire one narrow, policy-gated execution path (browser READ only) or explicitly record "browser execution out of scope for V2-8" — owner decision. |

Everything else in the §40 acceptance checklist is verified with evidence (see
`docs/V2_LIVE_QA_REPORT.md` for the item-by-item mapping). Safety invariants
(`AUTHORIZATION > ROUTING`, `HARD POLICY > JEV`, `HUMAN APPROVAL > PRODUCTION/DESTRUCTIVE`,
`PROJECT SCOPE > CAPABILITY AVAILABILITY`, `BROWSER POLICY > PAGE CONTENT`,
`DBPLANT READ-ONLY > GENERIC AGENT WRITE`, `SECRET HYGIENE`) held in every test.

Decision-support note: Jev was consulted on the readiness declaration with the full evidence
bundle (`declare_ready_yes` / `declare_blocked` / `declare_no` / `hold_for_more_evidence`) and
returned **declare_blocked**, confidence 0.57, probabilities {blocked 0.67, no 0.16, hold 0.15,
yes 0.02}. Jev advises; the approval remains with Prinya.

## 13. Artifacts

- `docs/V2_LIVE_QA_REPORT.md` — item-by-item live QA results
- `docs/V2_BENCHMARK_REPORT.md` — benchmark suite, metrics, limitations
- `docs/V2_ROLLBACK_RUNBOOK.md` — rollback/emergency procedure (rehearsed)
- `docs/evidence/v2-8/*.jsonl|json` — raw machine-readable results
- `ops/v2-qa-live.py`, `ops/v2-isolated-qa.py`, `ops/v2-supervisor-qa.mjs`, `ops/v2-browser-mcp-qa.mjs`, `ops/v2-benchmark.py` — reproducible harnesses
- Host backups: `~/agent-core/backups/20260925-014456/` (unit file, env file, previous release pointer, service state)
- Rollback rehearsal log: `~/agent-core/logs/rollback-rehearsal/20260925-020439.txt`
