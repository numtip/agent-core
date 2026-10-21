# Platform Status

## Groq / Hermes staging closeout — 2026-10-21 (VPS 237)

**Verdict: PASS** · Production Jev on `:8787` unchanged · Groq pilot **staging only** on `:8788`.

| Item | State |
|---|---|
| Production | `agent-core.service` **active** · `127.0.0.1:8787` · release `dbe20a5` · `/v2/inference/*` → **404** |
| Groq staging | `agent-core-groq-staging.service` **active** · `127.0.0.1:8788` · release `41195f6` (built tree, not `current`) |
| Model | `openai/gpt-oss-120b` (Groq) · `groq_fallback_openrouter: false` · `GROQ_MONTHLY_BUDGET_USD=10` |
| Auth | Project `groq-staging-v237` · scope **`inference` only** · credentials in `~/.config/agent-core/agent-core-groq-staging.env` (600) — **not recorded here** |
| Hermes | Skill `~/.hermes/skills/integrations/agent-core-groq-inference/` · CONTEXT_ONLY script `scripts/inference_complete.py` |
| Ledger (live) | spent **$0.0001665** · remaining **$9.999833** · **4** requests · `overspend_blocked: false` |

**Latest Hermes-initiated inference (evidence, no secrets):** `~/agent-core/logs/groq-staging-v237/hermes-oneshot.log` and `hermes-skill-script.json` — HTTP **200**, provider **groq**, ~**305–452 ms**, ~**$0.000046**/call; audit last row `INFERENCE_COMPLETE` / `groq` / `latency_ms: 299` in `~/agent-core/logs/groq-staging-v237/audit.jsonl`.

**Blockers:** none for loopback Hermes skill → staging → Groq. Orphan scratch listeners `18881–18888` (J2-C9C) remain unrelated to staging ledger; optional cleanup only.

---

## Multi-provider inference routing — source only, 2026-10-21

**Status: IMPLEMENTED in source · NOT DEPLOYED.** Production `:8787` stays on `dbe20a5`, staging `:8788` stays on `41195f6`.

- Route contract: `POST /v2/inference/complete` accepts `task` (`fast` | `reasoning` | `frontier`) in addition to `provider_preference`; responses gained `task` and `route`.
- Chains ([ADR 0003](adr/0003-multi-provider-inference-routing.md)): `fast → groq, deepseek` · `reasoning → deepseek, groq` · `frontier → openrouter, deepseek, groq`.
- Frontier (OpenRouter) tier is opt-in via `INFERENCE_FRONTIER_ENABLED=1`, never in `production`, and refused (`403 INFERENCE_FRONTIER_BLOCKED`) when the policy is off.
- Per-provider circuit breaker (in-process), shared monthly budget ledger, retries and timeouts unchanged from ADR 0001.
- Local benchmark with real credentials: [evidence/INFERENCE_MULTI_PROVIDER_BENCH_2026-10-21.json](evidence/INFERENCE_MULTI_PROVIDER_BENCH_2026-10-21.json).

---

## Current runtime line

Verified on VPS `ubantu24` (`10.1.254.237`) at 2026-10-13 23:16 +07 by reading the live user unit, and re-read at 23:23 +07 (same symlink, same MainPID, health still `0.7.0`). No restart and no deploy were part of either check. Closeout status: **SECURITY_SOURCE_MERGED — PRODUCTION_PENDING**. Documentation closeout: **CLOSEOUT_DOCUMENTED** at `c1411eb` (PR #32). The morning audit that still says the live SHA is unknown is historical: [audits/AGENT_CORE_REALITY_AUDIT_20261013.md](audits/AGENT_CORE_REALITY_AUDIT_20261013.md).

- **Deployed package:** `0.7.0`. Loopback `GET http://127.0.0.1:8787/v1/health` returned `status: ok`, `version: 0.7.0`, `auth_required: true`, `provider_configured: true`, model `~typesafe/jev-latest`.
- **Deployed release:** `~/agent-core/releases/dbe20a5` (`dbe20a5543c07996aafc9f39ceb050007ce79842`). `current` resolves to that directory. `agent-core.service` MainPID `2891042`, active since 2026-10-12 13:03:42 +07 (user-space systemd, Node v22.22.2). `agent-core-browser-mcp.service` MainPID `3563237`, active. Ten release directories are still on disk.
- **Rollback release:** `~/agent-core/releases/01092e2` (parent of the deployed commit). v1 baselines `releases/188de03` and `releases/9d2e9a9` are still on disk and are not the current symlink.
- **Production capabilities (8):** `deterministic.runtime`, `model.frontier`, `agent.cursor`, `agent.codex`, `agent.hermes`, `tool.git`, `mcp.playwright`, `knowledge.openwiki`. Counted in the deployed `dist/src/capability-registry.js`.
- **Production project identities (6):** `52clips`, `attendance-report-generator`, `handbook`, `goffice2026`, `dbplant`, `rae-attendance-v2`. `rae-attendance-v2` is activated with scope `decision` only. Tokens are not recorded in this file.
- **GitHub `main` is not this release.** At session close `main` is `c1411ebbee6a6633fbf8e7a5a8136bed6e9921f5` ([PR #32](https://github.com/numtip/agent-core/pull/32), docs only). The last runtime commit is `607b41e` ([PR #31](https://github.com/numtip/agent-core/pull/31)). Neither is deployed. Source on `main` registers **11** capabilities and a seventh profile, `agent-core`, adds `POST /v2/rea/route`, and contains the security and ops hardening below. See [Security closeout](#security-closeout--2026-10-13) and [Undeployed commits](#undeployed-commits-on-main).
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
  54/54 benchmark samples, rollback rehearsed (1.21 s window). That flag describes the V2-8 activation of the **deployed** line. It does not mean the 2026-10-13 security commits are running.

## Security closeout — 2026-10-13

**Status:** `SECURITY_SOURCE_MERGED — PRODUCTION_PENDING`. Detail: [SECURITY_HARDENING_2026-10.md](SECURITY_HARDENING_2026-10.md), [OPS_TOOLING_HARDENING_2026-10.md](OPS_TOOLING_HARDENING_2026-10.md).

### Source (merged, not running)

| Item | State |
|---|---|
| `main` HEAD | `c1411ebbee6a6633fbf8e7a5a8136bed6e9921f5` (docs). Last runtime commit `607b41e` |
| [PR #30](https://github.com/numtip/agent-core/pull/30) | MERGED, squash `0b8eed9738df7497b84464f8e04022d506cd0c5a`. Not deployed |
| [PR #31](https://github.com/numtip/agent-core/pull/31) | MERGED, squash `607b41e230a25a99c3481702a4260738b8d354af`. Not deployed |
| [PR #32](https://github.com/numtip/agent-core/pull/32) | MERGED, squash `c1411eb`. Docs only |
| [PR #4](https://github.com/numtip/agent-core/pull/4) | **OPEN / CONFLICTING / DIRTY**. Not rebased. Not closed |

Completed in git, and absent from the running `dbe20a5` binary:

1. Project-key lookup uses an own property. A `constructor` or `__proto__` project header is 401, not 500.
2. A malformed JSON env value is rejected without echoing the value. Credential headers are redacted in logs.
3. `/v1/subagent/complete` accepts only a subgoal key owned by the calling project.
4. SSRF checks cover non-global IPv4 and IPv6. DNS failure or any private answer is a deny. The final page URL is checked again after navigation.
5. Browser input uses one MCP session for navigate, snapshot, and type, and the snapshot ref must exist.
6. `/control` and `/v1/control-metrics` require a Cloudflare Access JWT or a project token with `metrics` scope. Unconfigured Access returns 503 `CONTROL_AUTH_NOT_CONFIGURED`.
7. Operator scripts in git rotate every onboarded project, keep secrets out of argv, write atomically at mode 0600, and fail closed. Cloudflare identifiers and the handoff fingerprint are required environment variables, with no defaults in git.

### Production baseline (read-only at 2026-10-13 23:16 +07)

| Check | Observed |
|---|---|
| `readlink -f ~/agent-core/current` | `/home/prinyaroot/agent-core/releases/dbe20a5` |
| `RELEASE_SHA` | `dbe20a5543c07996aafc9f39ceb050007ce79842` |
| `GET http://127.0.0.1:8787/v1/health` | 200, `"version":"0.7.0"`, `auth_required: true` |
| `agent-core.service` | active, MainPID `2891042`, since 2026-10-12 13:03:42 +07 |
| `agent-core-browser-mcp.service` | active, MainPID `3563237` |
| Release directories | 10, including rollback `releases/01092e2` |
| Ops backup | `~/agent-core/backups/ops-audit-20261013-223304/` present. Not modified by the git merge |

### Pending before any deploy

Do not promote `607b41e` until the owner approves a release. Required at that later step:

1. Build the release from `607b41e` and run `tsc` plus `vitest` on that tree.
2. Set `AGENT_CORE_CF_ACCESS_TEAM_DOMAIN` and `AGENT_CORE_CF_ACCESS_AUD` **before** switching the symlink. Without them, `/control` and `/v1/control-metrics` return 503.
3. Egress proxy unit `deploy/systemd/agent-core-egress-proxy.service` (loopback `8792`) is **not installed**. Until the browser MCP is started with `--proxy-server http://127.0.0.1:8792`, redirects, subresources, and a short DNS-rebinding window stay open. This closeout does not install the unit or change MCP.
4. Callers of `BROWSER_INPUT` must send a snapshot ref (for example `e12`). CSS selectors are rejected.
5. Isolated QA: `npm run qa:browser-hardening` on the release tree, then origin checks: `/v1/health` 200, `/control` via Access 200, `/control` on the origin without credentials 401.
6. Host copies of the ops scripts were fixed in place earlier and were **not** replaced by PR #31. Promoting the git copies requires the `CF_*` and `HANDOFF_EXPECT_FP` variables. Until then, `qa-local.py` from git expects `/control` to fail closed; the deployed release still serves it open at the origin, so use `QA_LEGACY_OPEN_CONTROL=1` against `dbe20a5`.

### Known vulnerabilities (2026-10-13, `npm audit` on `607b41e`, no packages changed)

| Scope | Result |
|---|---|
| Production dependencies (`npm audit --omit=dev`) | 0 |
| Dev dependencies | 3, all via `vitest` `^3.0.0`: `@vitest/mocker` moderate (path traversal in the redirect mock, range `2.1.0 - 4.1.10`), `tinypool` critical (prototype-pollution gadget, `<=2.1.1`), `vitest` critical (same mocker range, `0.0.95 - 4.1.10`) |

These dev advisories are not in the production runtime. The fix is a major `vitest` upgrade and is **not** done here.

### Token rotation

**OWNER-MANAGED / PENDING.** Project tokens were printed into an agent-session log on 2026-10-13. That log was removed. This closeout does not read, print, or rotate any credential. When the owner chooses to rotate, the dry run comes first:

```bash
python3 ~/agent-core/ops/rotate-project-tokens.py --dry-run
```

A real rotation also requires re-doing the `rae-attendance-v2` handoff, because the fingerprint changes. Do not run the real rotation from a documentation change.

### Rollback

Nothing in the merged security commits has been switched into production, so there is nothing to roll back tonight.

If a future release of `607b41e` must be undone, point the symlink back at this baseline and restart only that service:

```bash
ln -sfn ~/agent-core/releases/dbe20a5 ~/agent-core/current
systemctl --user restart agent-core.service
curl -sS -m 3 http://127.0.0.1:8787/v1/health
```

Expected after that rollback: `"version":"0.7.0"`. `AGENT_CORE_CF_ACCESS_TEAM_DOMAIN`, `AGENT_CORE_CF_ACCESS_AUD`, and `AGENT_CORE_CONTROL_AUTH` are ignored by `dbe20a5` and can stay. If the browser MCP was given `--proxy-server`, remove that flag and restart `agent-core-browser-mcp.service`. If the egress proxy unit was installed: `systemctl --user disable --now agent-core-egress-proxy.service`.

Rolling back the **current** production release itself (not the security commits) is still the older pointer:

```bash
ln -sfn ~/agent-core/releases/01092e2 ~/agent-core/current
systemctl --user restart agent-core.service
```

Do not run either restart to publish documentation.

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
| V2-6 Control Center v2 | COMPLETE + LIVE | Deployed `dbe20a5`: `/control` 200 on the origin, 302 behind Access externally. `main` (`0b8eed9`) fails closed at the origin and is **not deployed** |
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
3. Deployed `dist/src/auth.js` uses `Object.hasOwn` for scopes and still reads `projectKeys[project]` without it. `main` (`0b8eed9`) fixes that lookup. The fix is not deployed.
4. No HTTP route for the Supervisor in deployed `0.7.0` (module-level only).
5. Deployed `GET /control` and `GET /v1/control-metrics` have no application auth guard (loopback bind plus edge protection). `main` returns 503 when Access is unset and 401 without a valid JWT or metrics-scoped token. Not deployed.
6. `/v2/*` has project-token auth and the edge rate limit. The 2026-10-12 activation record says there is no Cloudflare Access application in front of `/v2/*`. The public edge was not re-probed on 2026-10-13.
7. Adapter YAML feature flags are declarative contracts, not runtime-enforced permissions.
8. The deployed browser URL guard is literal, so DNS rebinding remains possible on `dbe20a5`. `main` adds a DNS pre-check and a final-URL check. The egress proxy that closes redirect and rebinding gaps is not installed.
9. `User-Agent: python-urllib/*` was refused at the edge (Cloudflare error 1010) in an earlier check. Not re-tested on 2026-10-13.
10. [PR #4](https://github.com/numtip/agent-core/pull/4) (`ops/production-activation`) is **OPEN / CONFLICTING / DIRTY**. It was not rebased and not closed. It is not the deployed SHA. It overlaps PR #31 in `activate-user-space.sh`, `inject-openrouter-key.sh`, `qa-local.py`, and `rotate-project-tokens.py`.
11. `PLAYWRIGHT_MCP_EXECUTION_ENABLED=true` on the host. Browser scope is held by `goffice2026` and `handbook` only.
12. Dev-only `vitest` advisories (1 moderate, 2 critical) remain. Production `npm audit --omit=dev` is 0. No upgrade in this closeout.
13. Token rotation is **OWNER-MANAGED / PENDING**. No credential was read or rotated for this checkpoint.

## Undeployed commits on main

`origin/main` at `c1411eb` contains runtime that the VPS is not running. The tip itself is docs (PR #32). Do not treat these as production. The previous checkpoint in this file was `607b41e` (PR #31).

| Commits | What landed in git | If it were deployed |
|---|---|---|
| `#21` `f736bc7` | `knowledge.observation`, `knowledge.memory-store`, client-side redaction, broader `/v2/knowledge/query` sources, project profile `agent-core` | Callers with `context` could request observation and memory-store handoffs. The new profile grants nothing until a project token exists |
| `#23` `c3666b7` | Capability-registry touch plus REA preflight test | Bundled with the REA route below |
| `#24` `93a4a36`, `#26` `8e77ab5` | `POST /v2/rea/route` (scope `route`), allowlist profiles v1/v2, `package-lock.json` | New route for identities that hold `route`. Default `REA_LOCAL_HANDOFF_ENABLED=false`. `mcp.rea` is `PLANNED` and marked `vps_execution: false` |
| `#20` `#25` `#27` `#28` `#29` `e876511` | Audits, memory, and the previous production-pointer docs | No runtime change |
| `#30` `0b8eed9` | Fail-closed SSRF, one MCP session for browser input, origin auth for `/control` | Not deployed. Needs the Access env vars in [Security closeout](#security-closeout--2026-10-13) or `/control` returns 503 |
| `#31` `607b41e` | Hardened operator scripts and synthetic-credential tests | Not deployed. Host `~/agent-core/ops/` was not replaced |
| `#32` `c1411eb` | This status file and the memory notes at that time | No runtime change |

None of these commits change the Jev client timeout or add a retry. The deployed client remains a single 8000 ms attempt.

## Re-check the live pointer

```bash
readlink -f ~/agent-core/current
cat ~/agent-core/current/RELEASE_SHA
curl -sS -m 3 http://127.0.0.1:8787/v1/health
systemctl --user is-active agent-core.service
```

Expected: path ends in `releases/dbe20a5`, SHA `dbe20a5543c07996aafc9f39ceb050007ce79842`, JSON `"version":"0.7.0"`, unit `active`, MainPID unchanged unless an approved restart already happened.

Rollback of the **running** service (not of this documentation, and not of the unreleased security commits) remains:

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
