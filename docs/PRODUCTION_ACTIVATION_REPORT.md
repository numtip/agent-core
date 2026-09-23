# Production Activation Report — Agent Core

Status: **PARTIAL — runtime active on the target VPS; the Cloudflare edge layer is still BLOCKED on an
operator-supplied credential, and the live-Jev adapter fix is verified but not yet promoted to production.**

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

## 7. Cloudflare layer — BLOCKED

No Cloudflare credential exists in the execution environment: `~/.cloudflared/cert.pem` is absent and
`cloudflared tunnel list` fails with "Cannot determine default origin certificate path". The operator
chose to create an API token.

Prepared and rehearsed:

- `ops/cloudflare-ingress-sudo.sh` — adds `agent.raemanagemju.net → http://127.0.0.1:8787` to
  `/etc/cloudflared/config.yml` (backup, insert before the catch-all, `ingress validate`, resolve every
  existing hostname, restart, rollback on failure). **Rehearsed against a copy of the live config:
  validate `OK`; rule #7 matched for `agent.raemanagemju.net`; `webhook`, `ssh`, `handbook`, `litellm`,
  `raemanagemju.net` all still resolve to their original services; live cloudflared left untouched.**
- `ops/cloudflare-edge.py --plan|--apply` — token verify, zone/account discovery, CNAME
  `agent → 98cc1f81-c265-4c44-a61d-5271a2cad897.cfargotunnel.com` (proxied), Access apps for
  `/control` + `/v1/control-metrics` (email allow + explicit deny), Access app for `/v1/*`
  (service-token only), and zone rate-limit rules (600 req/min per IP on the machine API, 120 req/min on
  the control surface — deliberately generous so development stays usable; the app's own per-project
  limiter remains the primary control).

Required token permissions (Cloudflare dashboard → My Profile → API Tokens), zone `raemanagemju.net`:

```text
Zone    -> DNS                    -> Edit
Zone    -> Zone                   -> Read
Zone    -> WAF                    -> Edit     (rate limiting rules)
Account -> Access: Apps and Policies -> Edit
Account -> Account Settings       -> Read     (optional, auto-discovers the account id)
```

Place the token at `~/.config/agent-core/cloudflare.token` (mode 600) or export `CF_API_TOKEN`.

A second connector on the same tunnel ID with a divergent ingress list must NOT be started:
Cloudflare load-balances across connectors, which would break the existing hostnames.

## 8. Blockers

| # | Item | Blocker |
|---|---|---|
| B1 | Cloudflare Tunnel ingress, DNS, Access, WAF for `agent.raemanagemju.net` | API token not yet provided (section 7). Ingress step also needs one `sudo` run (`ops/cloudflare-ingress-sudo.sh`). |
| B2 | Promote the live-Jev fix to production | Needs PR #5 approval + merge (then one release-pointer change / restart) |
| B3 | Root-owned layout migration | Optional; operator will run `sudo bash ops/migrate-to-system-layout.sh` when convenient |
| B4 | Public-hostname QA + 52Clips pilot connectivity | Depends on B1 |

## 9. Rollback

User-space runtime (current production):

```bash
systemctl --user stop agent-core.service          # or: disable --now
# to return to an earlier build:
ln -sfn releases/<previous-release-id> ~/agent-core/current && systemctl --user restart agent-core.service
# full removal:
systemctl --user disable --now agent-core.service && rm -rf ~/agent-core ~/.config/agent-core
```

Cloudflare (after the ingress entry is added):

```bash
sudo cp -a /etc/cloudflared/config.yml.bak.agent-core-<timestamp> /etc/cloudflared/config.yml
sudo systemctl restart cloudflared
```

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
