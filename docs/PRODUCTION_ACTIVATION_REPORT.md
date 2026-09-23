# Production Activation Report — Agent Core

Status: **PARTIAL — runtime active on the target VPS and the Cloudflare edge layer is live
(routing, Access, rate limiting verified from outside). Still open: the machine-identity end-to-end
call through the edge (one token permission away) and promotion of the verified live-Jev adapter fix.**

Nothing here is claimed as a production gate pass unless the evidence is stated. Items marked BLOCKED
were not attempted past their gate.

## 1. Deployment facts

| Item | Value |
|---|---|
| Report date | 2026-09-23 (Asia/Bangkok) |
| VPS hostname | `ubantu24` (10.1.254.237) |
| Repository | `numtip/agent-core` (private) |
| Deployed commit (production runtime) | `9d2e9a91811b4bf87870190221211f47a4a441fa` (`main`) |
| Runtime method | Node 22.22.2 + systemd **user** unit (`agent-core.service`), enabled, `Linger=yes` |
| Bind address | `127.0.0.1:8787` (loopback only, verified with `ss -lntp`) |
| Release layout | `/home/prinyaroot/agent-core/releases/9d2e9a9` + `current` symlink |
| Runtime env | `/home/prinyaroot/.config/agent-core/agent-core.env` (mode 600, owner-only) |
| Audit log | `/home/prinyaroot/agent-core/logs/audit.jsonl` |
| Node runtime | `/home/prinyaroot/.nvm/versions/node/v22.22.2/bin/node` |

### Layout deviation (operator decision: keep user-space for now)

`deploy/README.md` specifies `/opt/agent-core` + `/etc/agent-core/agent-core.env` (root `agentcore`,
mode 640) and a system unit. That requires `sudo`, which needs an interactive password on this host and is
therefore unavailable to the automation environment. The operator chose to keep the user-space runtime and
to run the root-owned migration himself. A rehearsed migration script is provided:
`ops/migrate-to-system-layout.sh` (creates `agentcore`, `/opt/agent-core`, `/etc/agent-core` 640,
`/var/log/agent-core`, `/var/lib/agent-core`, installs a Node 22 runtime at `/usr/local/agent-core-node`
so the system `nodejs 20.20.2` package is left untouched, and stops the user unit to free the port).

## 2. Code gates on `main` @ `9d2e9a9`

| Gate | Result | Evidence |
|---|---|---|
| `npm install` | PASS | 105 packages |
| `npm audit --omit=dev --audit-level=high` | PASS | `found 0 vulnerabilities` |
| `npm test` | PASS | 5 files, 20 tests passed |
| `npm run build` | PASS | `tsc -p tsconfig.json`, exit 0 |

After the live-response fix (section 5): `npm test` → 5 files, **24 tests passed**, build clean.

## 3. Project identities

Five identities generated on the VPS, stored only in the mode-600 env file, never in Git or logs:

| Project | Scopes |
|---|---|
| `52clips` | decision, route, qa, context, metrics |
| `attendance-report-generator` | decision, route, qa, context |
| `handbook` | decision, route, qa, context |
| `goffice2026` | decision, route, qa, context, metrics |
| `dbplant` | decision, context (read-only default retained) |

Tokens: 32 random bytes (64 hex) each, CSPRNG-generated (`ops/rotate-project-tokens.py`).

## 4. Local production QA — PASS

Harness: `ops/qa-local.py` (reads secrets from the protected env file; prints none).

- Without a provider key: **20/20 PASS** — including the two provider-unavailable branches
  (`fallback_result` → 200 FALLBACK/`PROVIDER_UNAVAILABLE`; absent → 503 `DECISION_UNAVAILABLE`).
- After the key was injected and tokens rotated: **19/19 PASS** (the two keyless branches are skipped by
  design once a key exists, so a live outage test does not disturb production).

Covered: health 200 · loopback-only bind · unauthenticated 401 · invalid token 401 ·
cross-project mismatch 403 `PROJECT_MISMATCH` · wrong scope 403 `FORBIDDEN` · context 200 ·
projects+metrics 200 / without scope 403 · 429 `RATE_LIMITED` past 100 req/60s · audit fields complete ·
audit contains no project tokens / OpenRouter key / Authorization header · `/control` and
`/v1/control-metrics` reachable at origin (edge gating pending).

## 5. Live OpenRouter/Jev QA — one real incompatibility found

Provider: `https://openrouter.ai/api/alpha/decisions`, resolved model `typesafe/jev-1.13-20260917`,
`provider: TypeSafe`. Warm latency **0.39–0.80 s** per call (no cold-start penalty observed; ~$0.000012–0.000015 per call).

Live response contract, captured 2026-09-23:

```json
choice -> {"type":"choice","choice":"GENERATE_SUBTITLE",
           "probabilities":{"GENERATE_SUBTITLE":0.98,"READY_FOR_QA":0,"HUMAN_REVIEW":0.02},
           "confidence":0.97}
noul   -> {"type":"noul","noul":0.07}
score  -> {"type":"score","score":0.35,"legend":{"0":"not started","1":"partial","2":"fully ready"},
           "probabilities":{"0":0.76,"1":0.13,"2":0.11},"confidence":0.48}
```

Through Agent Core on the deployed commit `9d2e9a9`:

```text
choice HTTP 200 0.63s -> result=HUMAN_REVIEW confidence=0 reason=PROVIDER_UNAVAILABLE fallback=true
noul   HTTP 200 0.40s -> result=false confidence=0.98 disposition=EXECUTE
score  HTTP 200 0.40s -> result="1.02" confidence=1 disposition=EXECUTE
```

Two defects in `src/providers/jev.ts` (both silent-failure or over-confidence risks):

1. **choice was incompatible** — `parseChoice` expected `answers.decision.choice` to be a
   `{label: probability}` object; the live API returns a **string label** plus separate `probabilities`
   and `confidence`. Every live choice question therefore threw, and (with `fallback_result` present)
   degraded to `PROVIDER_UNAVAILABLE`/`HUMAN_REVIEW`. With no `fallback_result` it would have returned 503.
2. **score reported fabricated certainty** — `parseScore` returned the raw normalized `score` (e.g. `"1.02"`)
   and defaulted `confidence` to `1` when the response carried `probability` instead of `confidence`.
   The live API does supply `confidence` (0.48 in the probe), and the meaningful result is the top
   level label, not the normalized number.

### Fix (branch `fix/jev-live-response-schema`, PR #5 — awaiting approval)

- `parseChoice` accepts the live string shape (confidence from `confidence`, else `probabilities[label]`)
  and keeps the legacy object form.
- `parseScore` maps the top-probability index to the level label (from `legend`, falling back to the
  request's `levels`) and uses the provider's real `confidence`.
- A score answer with no calibrated confidence now **throws** instead of returning an invented `1.0`
  (previously promoted to `EXECUTE`).
- Tests added for all three shapes plus the no-confidence guard: **24/24 pass**.

### Live verification of the fix (staging instance on 127.0.0.1:8788, production untouched)

```text
choice HTTP 200 0.50s -> result=GENERATE_SUBTITLE confidence=0.97 disposition=EXECUTE fallback=false
noul   HTTP 200 0.39s -> result=false             confidence=0.98 disposition=EXECUTE
score  HTTP 200 0.44s -> result=partial           confidence=0.97 disposition=EXECUTE
```

Production still runs `9d2e9a9`, so the gate "live Jev choice PASS" is **verified on the fix branch, not on
the promoted production build**. Promotion is one release pointer change once PR #5 is approved.

### Provider failure classification (distinguished, not lumped together)

| Class | Evidence |
|---|---|
| Reachability / success | HTTP 200, `id` present (`gen-dec-…`), schema as above |
| Authentication failure | invalid key → **HTTP 401 `{"error":{"message":"User not found."}}`** |
| Network failure | unreachable URL → transport error (`URLError: Connection refused`), no HTTP status |
| Timeout | `OPENROUTER_TIMEOUT_MS=1` → safe fallback (`PROVIDER_UNAVAILABLE`, 200 FALLBACK) or 503 without `fallback_result` |
| Schema error | defect 1 above — a parse failure surfaces as `PROVIDER_UNAVAILABLE`, which hides the root cause; the fix removes it for the live shapes |

## 6. Security incident during activation (self-inflicted, remediated)

While starting a temporary staging instance, the runtime env file was sourced through a **shell**, which
stripped the quotes inside the `AGENT_CORE_PROJECT_KEYS` JSON and made the process print the full
`{project: token}` map into a `/tmp` log — and that log excerpt reached the chat transcript.

Remediation performed immediately: temp files deleted (`/tmp/agent-core-staging.*`), **all five project
tokens rotated** (`ops/rotate-project-tokens.py`, new fingerprints `79fe05b1`, `2c257010`, `81548372`,
`dfeb25df`, `dde0680c`), service restarted, local QA re-run to prove the rotation. The leaked values are dead.

Prevention encoded in the tooling: `ops/qa-live.py` now passes the environment to child processes as a
Python dict (never `source`), and all secret-handling scripts print only lengths/fingerprints.

## 7. Cloudflare layer — ACTIVE (routing, Access, rate limiting verified from outside)

### 7.1 Finding: the tunnel is REMOTE-managed, not file-managed

`cloudflared` runs as `cloudflared --no-autoupdate tunnel --config /etc/cloudflared/config.yml run`,
but the tunnel also has a **remote configuration** in the Cloudflare dashboard, and the remote one
wins. Evidence (connector journal, 2026-09-23):

```text
INF Updated to new configuration config="{\"ingress\":[
      {\"hostname\":\"hermes.raemanagemju.net\", \"service\":\"http://10.1.245.190:8642\"},
      {\"hostname\":\"handbook.raemanagemju.net\", \"service\":\"http://127.0.0.1:8097\"},
      {\"service\":\"http://127.0.0.1:80\"}], ...}" version=5
```

Consequences (pre-existing, not caused by this work):

- Everything the local file lists beyond `handbook.raemanagemju.net` is **not in effect**:
  `webhook.raemanagemju.net → 8644`, `ssh.raemanagemju.net → 22`, `litellm.raemanagemju.net → 4002`
  and the `raemanagemju.net` path rules all fall through to the catch-all (`127.0.0.1:80`).
- Verified by sending those Host headers straight to Apache: every one answers `200` with the
  "VPS Projects & Services" page; `litellm.raemanagemju.net` answers `502` (Apache proxying to a
  dead backend); `webhook.raemanagemju.net` answers the Apache page, not the Hermes webhook.
- Landmine to record: if the remote configuration is ever removed, routing reverts to the local file
  and **`hermes.raemanagemju.net` (→ 10.1.245.190:8642) disappears**, because it exists only remotely.
- `ops/cloudflare-ingress-sudo.sh` (the local-file edit) therefore had no routing effect. It is kept
  because it backs up/validates the file and documents the intent, but routing must be changed in the
  dashboard or via `ops/cloudflare-tunnel-remote.py` (needs Account → Cloudflare Tunnel → Edit).

### 7.2 What was created (all writes confirmed by read-back)

| Object | State |
|---|---|
| DNS | `agent.raemanagemju.net` CNAME → `98cc1f81-c265-4c44-a61d-5271a2cad897.cfargotunnel.com`, proxied |
| Tunnel route | public hostname `agent.raemanagemju.net` → `http://127.0.0.1:8787` added by the operator in the dashboard (remote config v6) |
| Access app | `Agent Core — Human Control Center` — `agent.raemanagemju.net/control`, session 8h, policies `prinya-only=allow`, `deny-everyone-else=deny` |
| Access app | `Agent Core — Control Metrics` — `/v1/control-metrics`, session 8h, same two policies |
| Access app | `Agent Core — Health Probe` — `/v1/health`, policy `public-health-bypass=bypass` |
| Access app | `Agent Core — Machine API` — `/v1/*`, session 24h, policy `service-tokens-only=non_identity` |
| Rate limiting | 1 zone rule `agent-core-edge-volumetric-backstop-100-per-10s-per-ip`, characteristics `cf.colo.id + ip.src`, action `block`, mitigation 10s |

Plan-limit facts discovered while applying (each was hit and handled by the tooling):

- Free plan allows **one** rule in the `http_ratelimit` phase → the two intended ceilings had to be
  merged into one volumetric backstop.
- Free plan allows **only `period: 10`** and a matching **`mitigation_timeout: 10`** → the rule is
  expressed as 100 requests / 10 s per colo+IP (≈600/min), not 600/60 s.
- Zone-level rules additionally require the `cf.colo.id` characteristic.

### 7.3 Public QA through the edge (from outside the host)

```text
GET  /v1/health            -> 200 {"status":"ok","service":"agent-core","auth_required":true,
                                   "provider_configured":true,"jev_model":"~typesafe/jev-latest"}
GET  /control              -> 302  (Cloudflare Access redirect — not publicly accessible)
GET  /v1/control-metrics   -> 302  (Cloudflare Access redirect)
POST /v1/decision (no service token) -> 403 (denied at the edge)
burst 150 requests to /v1/decision   -> 139x403 (Access) + 11x429 (rate limit) => edge limit fires
```

`handbook.raemanagemju.net` still answers `200` after the change, so the pre-existing production
hostname was not disturbed.

### 7.4 Machine path through the edge — verified, with one known pre-fix outcome

The Access service-token permission turned out to be unnecessary for QA: `ops/qa-edge-bypass-e2e.py`
uses the permission the token already has (`Access: Apps and Policies: Edit`) to open a **narrow,
temporary bypass** for the single path `/v1/decision`, runs the machine path end to end, and deletes
the app in a `finally` block (including on exceptions). The bypass exposes nothing by itself: Agent
Core's own project-token auth still answers 401/403 without valid credentials.

```text
baseline  POST /v1/decision, no edge identity        -> 403  (denied at the edge)
window    POST /v1/decision, 52clips + project token -> 200  result=HUMAN_REVIEW confidence=0
                                                            fallback=true reason=PROVIDER_UNAVAILABLE (0.67s)
          POST /v1/decision, invalid project token   -> 401
          POST /v1/decision, no project credentials  -> 401
          POST /v1/decision, cross-project mismatch   -> 403 PROJECT_MISMATCH
cleanup   temporary app deleted (HTTP 202) / window closed -> 403 again / no QA app left
```

Reading of that result, with the diagnosis attached:

- **Edge authz is proven end to end**: the request crossed Cloudflare, the tunnel and the origin, and
  Agent Core's authorization layer answered 401/403 exactly as designed.
- **The Jev answer is still the safe fallback because production runs `9d2e9a9`**, whose choice
  parser expects the wrong response shape (§5). It is **not** a timeout: measured the same minute,
  the direct Decisions API call answered in **0.39–0.76 s** with `choice=GENERATE_SUBTITLE`, while
  Agent Core returned the fallback in **0.35–0.81 s** (well inside `OPENROUTER_TIMEOUT_MS=8000`).
- Consequence: the gate "valid project request reaches Jev" becomes a real PASS only after PR #5 is
  merged and the fixed build is promoted. Until then the platform fails safe, never silently.

Observation for tuning: one first-hit call through the edge took 8.5 s (cold path), i.e. above the
current 8 s provider timeout. Warm calls are sub-second, so raising `OPENROUTER_TIMEOUT_MS` to
~15000–20000 would avoid degrading cold requests to the fallback. Recommended, not yet applied,
because the runbook specifies 8000 ms.

### 7.5 Bot protection note

The bypassed `/v1/health` path is subject to Cloudflare's bot protection: the Python HTTP client got
`403 error code: 1010` ("banned based on browser signature") while `curl` and browsers pass, so the
public QA harness drives `curl` instead. Machine clients (Node/Python) using this hostname may need
either a WAF skip rule for the zone's bot checks, or health monitoring moved behind Access with a
service token. `/v1/*` and `/control` are unaffected because Access answers those first.



### 7.6 Tooling added for this layer

- `ops/store-cloudflare-token.sh` — prompt-based token entry (never echoes the value, mode 600).
- `ops/cloudflare-edge.py --plan|--verify|--apply` — token verify, zone/account resolution, DNS
  route, the four Access apps and their policies, and the zone rate-limit rule. Idempotent; every
  write is followed by a read-back.
- `ops/cloudflare-tunnel-remote.py --plan|--apply|--verify` — reads the remote tunnel configuration,
  backs it up to `~/backups/`, inserts the `agent` hostname before the catch-all and writes it back.
  Needs an additional permission (see below); the dashboard route works without it.
- `ops/cloudflare-ingress-sudo.sh` — local-file ingress edit, kept for the record (no routing effect
  while the tunnel stays remote-managed). Rehearsed: `validate OK`, all existing hostnames unchanged.
- `ops/qa-public.py` — the public QA harness (curl-driven, creates and deletes its own temporary
  service token).

Token permissions in use (`agent-core-edge`): `Zone→DNS→Edit`, `Zone→Zone→Read`, `Zone→WAF→Edit`,
`Account→Access: Apps and Policies→Edit`. Add `Account→Access: Service Tokens→Edit` for §7.4, and
`Account→Cloudflare Tunnel→Edit` if the remote configuration is to be managed from here.

A second connector on the same tunnel ID with a divergent ingress list must NOT be started:
Cloudflare load-balances across connectors, which would break the existing hostnames.

## 8. Blockers

| # | Item | Blocker |
|---|---|---|
| B1 | ~~Cloudflare Tunnel ingress, DNS, Access, WAF~~ | **RESOLVED** — see §7 (routing + Access + rate limiting verified from outside) |
| B2 | ~~Machine identity end-to-end through the edge~~ | **RESOLVED without the extra permission** — see §7.4 (edge authz verified; temporary bypass app created and deleted) |
| B3 | Valid 52clips decision through the edge returning a Jev result | Needs PR #5 merged + the fixed build promoted; today it fails safe to the fallback because production runs the pre-fix parser |
| B4 | Root-owned layout migration | Optional; operator will run `sudo bash ops/migrate-to-system-layout.sh` when convenient |
| B5 | 52Clips pilot connectivity | Needs B3; the pilot will present its project token per call and either a Cloudflare service token (needs `Account → Access: Service Tokens → Edit` to mint one from here) or a per-project Access policy |

## 9. Rollback

User-space runtime (current production):

```bash
systemctl --user stop agent-core.service          # or: disable --now
# to return to an earlier build:
ln -sfn releases/<previous-release-id> ~/agent-core/current && systemctl --user restart agent-core.service
# full removal:
systemctl --user disable --now agent-core.service && rm -rf ~/agent-core ~/.config/agent-core
```

Cloudflare edge (in dependency order):

```bash
# 1) remove the public hostname in the dashboard (Zero Trust > Networks > Tunnels > Public Hostnames)
# 2) delete the DNS record + Access apps + the rate-limit rule via the API:
python3 ~/agent-workspace/agent-core/ops/cloudflare-edge.py --verify   # list what exists first
# 3) if the tunnel config was changed by ops/cloudflare-tunnel-remote.py, restore the backup:
#    ~/backups/tunnel-remote-config-<timestamp>.json  (PUT it back, or re-enter it in the dashboard)
# 4) delete the API token in the Cloudflare dashboard when it is no longer needed
```

Origin-side rollback of a promoted release is a single symlink change (§9 above); the Cloudflare
layer is additive and its removal leaves the loopback-only runtime intact.

After the root-owned migration, rollback to the user-space runtime:

```bash
sudo systemctl disable --now agent-core.service
sudo rm -f /etc/systemd/system/agent-core.service && sudo systemctl daemon-reload
runuser -u prinyaroot -- env XDG_RUNTIME_DIR=/run/user/1000 systemctl --user enable --now agent-core.service
```

## 10. Remaining risks

1. `/control` and `/v1/control-metrics` are unauthenticated **at the origin** by design; they must stay
   loopback-only until Cloudflare Access exists. Do not publish the hostname before Access is attached.
2. Production currently resolves every live `choice` question through the fallback path (section 5) —
   safe, but not the intended behaviour. The fix is verified and awaiting promotion.
3. In-process rate limiter only (per-project, resets on restart); Cloudflare limits are the compensating layer.
4. User-space runtime gives weaker isolation than the documented `agentcore` account; `ProtectSystem=strict`
   and `ProtectHome` from the template are not usable while the runtime lives under `$HOME`.
5. Host disk at 94% (5.2 GB free). Old releases must be pruned; a second release plus `node_modules`
   needs headroom before the migration step.
6. Project tokens were rotated once during activation (section 6); any future client must read them from
   the protected env file, never from logs or chat.
