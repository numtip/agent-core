# Production Activation Report — Agent Core

Status: **PARTIAL — local runtime active on the target VPS; Cloudflare edge layer and live OpenRouter/Jev QA are BLOCKED on credentials that only the operator can supply.**

Nothing in this report is claimed as production-complete. Every item marked PASS was observed
with the command/evidence noted. Items marked BLOCKED were not attempted past their gate.

## 1. Deployment facts

| Item | Value |
|---|---|
| Deployment date | 2026-09-23 (Asia/Bangkok) |
| VPS hostname | `ubantu24` (10.1.254.237) |
| Repository | `numtip/agent-core` (private) |
| Deployed commit | `9d2e9a91811b4bf87870190221211f47a4a441fa` (`feat: complete Agent Core phases 2-8 platform`) |
| Branch | `main` |
| Runtime method | Node 22.22.2 (`~/.nvm/versions/node/v22.22.2/bin/node`) + systemd **user** unit (see deviation note) |
| Service | `agent-core.service` (`systemctl --user`), enabled, `active (running)` |
| Bind address | `127.0.0.1:8787` (loopback only) |
| Audit log | `/home/prinyaroot/agent-core/logs/audit.jsonl` |
| Runtime config | `/home/prinyaroot/.config/agent-core/agent-core.env` (mode `600`, owner-only) |

### Deviation from the target layout (requires operator action)

The runbook asks for `/opt/agent-core/releases/<release-id>` + `/etc/agent-core/agent-core.env`
(root `agentcore` account, mode 640). That layout requires `sudo`, and on this host `sudo`
requires an interactive password (`sudo -n true` → "a password is required"), which the
automation environment does not have. A **user-space deployment** was performed instead so that
the platform is live and verifiable without elevating privileges:

```text
/home/prinyaroot/agent-core/
├── releases/9d2e9a9/          # production dependencies + built dist
└── current -> releases/9d2e9a9
/home/prinyaroot/.config/systemd/user/agent-core.service
/home/prinyaroot/.config/agent-core/agent-core.env   (mode 600)
```

This is functionally equivalent for the HTTP contract, and fully reversible, but it means:
- the service runs as `prinyaroot`, not a dedicated `agentcore` account;
- `NoNewPrivileges`/`PrivateTmp` are set, but `ProtectSystem=strict` + `ProtectHome` from the
  template cannot be used (the runtime lives under `$HOME`);
- the audit log is under `$HOME`, not `/var/log/agent-core`.

Migrating to the root-owned layout is a single follow-up step once operator approval is
available (`sudo` password or a pre-created `/opt/agent-core` + `/etc/agent-core` with the
`agentcore` user).

## 2. Build and test gates (pre-promotion, main @ 9d2e9a9)

| Gate | Result | Evidence |
|---|---|---|
| `npm install` | PASS | 105 packages, no errors |
| `npm audit --omit=dev --audit-level=high` | PASS | `found 0 vulnerabilities` |
| `npm test` | PASS | `Test Files 5 passed (5)`, `Tests 20 passed (20)` |
| `npm run build` | PASS | `tsc -p tsconfig.json`, exit 0 |

## 3. Project identities

Five independent project identities were generated on the VPS and stored **only** in the
protected runtime env file (never in Git, never in logs, never printed):

| Project | Scopes |
|---|---|
| `52clips` | decision, route, qa, context, metrics |
| `attendance-report-generator` | decision, route, qa, context |
| `handbook` | decision, route, qa, context |
| `goffice2026` | decision, route, qa, context, metrics |
| `dbplant` | decision, context (read-only default retained) |

Token format: 32 random bytes (64 hex chars) per project, generated with a CSPRNG.

## 4. Local QA results — 20/20 PASS

Harness: `ops/qa-local.py` (reads secrets from the protected env file; prints no secret values).

```text
[PASS] health 200                    {"status":"ok","service":"agent-core","version":"0.2.0","auth_required":true,"provider_configured":false,"jev_model":"~typesafe/jev-latest"}
[PASS] bound to 127.0.0.1:8787 only  LISTEN 127.0.0.1:8787 (no 0.0.0.0:8787 listener)
[PASS] unauthenticated protected request -> 401
[PASS] invalid token -> 401
[PASS] cross-project body/header mismatch -> 403 PROJECT_MISMATCH
[PASS] wrong scope (dbplant -> /v1/qa) -> 403 FORBIDDEN scope=qa
[PASS] provider unavailable + fallback_result -> 200 fallback=true result=HUMAN_REVIEW reason=PROVIDER_UNAVAILABLE
[PASS] provider unavailable + no fallback -> 503 DECISION_UNAVAILABLE
[PASS] /v1/context with context scope -> 200
[PASS] /v1/projects with metrics scope -> 200
[PASS] /v1/projects without metrics scope -> 403
[PASS] rate limit -> 429 RATE_LIMITED after 100 requests / 60s window   (105 requests issued)
[PASS] audit log present and populated with decision events
[PASS] audit event has required fields (project, route, decision_type, result, confidence, latency_ms, fallback, provider_request_id, timestamp)
[PASS] audit contains no project tokens
[PASS] audit contains no OpenRouter key
[PASS] audit contains no Authorization header
[PASS] /control serves dashboard at origin
[PASS] /v1/control-metrics reachable at origin
[PASS] service active (systemd user unit)
```

### Origin exposure

Port 8787 listens on `127.0.0.1` only, so it is not reachable from the LAN or the Internet.
No firewall changes were made (SSH connectivity untouched); `ufw` is active and enabled on the
host. Cloudflare edge protection (Access/WAF) is still pending and is therefore **not** yet
part of the security posture.

### Control Center caveat

`/control` and `/v1/control-metrics` are intentionally unauthenticated **at the origin** by
design (the code comment states the edge must gate them). Until Cloudflare Access exists, these
routes must stay loopback-only. Do not add a public Tunnel hostname before Access policy is in
place.

## 5. Blocked items (operator input required)

| # | Item | Blocker |
|---|---|---|
| B1 | Root-owned layout `/opt/agent-core` + `/etc/agent-core` + `agentcore` user + system-level unit | `sudo` requires an interactive password on this host |
| B2 | Cloudflare Tunnel ingress `agent.<domain>` → `http://127.0.0.1:8787` | No Cloudflare credential on the host: `~/.cloudflared/cert.pem` absent, no API token found, `cloudflared tunnel list` → "Cannot determine default origin certificate path" |
| B3 | Cloudflare DNS record for the chosen hostname | Same as B2 |
| B4 | Cloudflare Access applications for `/control` + `/v1/control-metrics`, machine identities per project | Same as B2 |
| B5 | Cloudflare WAF / rate-limit rules for `/v1/decision`, `/v1/route`, `/v1/qa`, `/v1/context`, `/v1/subagent`, `/v1/advanced-route` | Same as B2 |
| B6 | Live OpenRouter/Jev smoke QA (`choice`, `noul`, provider-error classification) | `OPENROUTER_API_KEY` is not exported into the Agent Core runtime env. A key exists elsewhere on the host (`~/agent-workspace/tools/jev/.env`, `~/.hermes/.env`) but reusing it is a credential-handling decision that requires operator approval. Without it the platform correctly reports `provider_configured: false` and exercises the safe fallback path. |
| B7 | Public hostname QA through Cloudflare (health, 401/403 through the edge, Control Center privacy) | Depends on B2–B5 |
| B8 | 52Clips pilot connectivity using the public URL | Depends on B7 |

The existing Cloudflare Tunnel on this host (`98cc1f81-c265-4c44-a61d-5271a2cad897`) already
serves `webhook.raemanagemju.net`, `ssh.raemanagemju.net`, `handbook.raemanagemju.net`,
`litellm.raemanagemju.net`, `/ai/*` and `/attendance-report/*` on `raemanagemju.net`. It is a
single shared connector, so adding the Agent Core hostname means one ingress entry in
`/etc/cloudflared/config.yml` (root-owned, needs sudo) **plus** a matching Cloudflare DNS route.
A second cloudflared connector on the same tunnel ID must **not** be started with a divergent
ingress list — Cloudflare load-balances across connectors on the same tunnel, which would
silently break the existing hostnames.

## 6. Rollback

The previous state is preserved: this was a first deployment, so there is no earlier release to
return to. Rollback of the user-space runtime:

```bash
systemctl --user disable --now agent-core.service
rm -f ~/.config/systemd/user/agent-core.service ~/agent-core/current
systemctl --user daemon-reload
# optional full removal
rm -rf ~/agent-core ~/.config/agent-core
```

If a release already exists and a new one has been promoted:

```bash
systemctl --user stop agent-core.service
ln -sfn releases/<previous-release-id> ~/agent-core/current   # inside ~/agent-core
systemctl --user start agent-core.service
```

Rollback of a future Cloudflare change: remove the `agent.<domain>` ingress entry from
`/etc/cloudflared/config.yml`, restart `cloudflared`, and delete the DNS record. Backup the
config before editing (`cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak.<ts>`).

## 7. Remaining risks

1. Origin Control Center routes are unauthenticated until Cloudflare Access exists — keep 8787 loopback-only and do not create the public hostname before the Access policy.
2. The runtime currently lacks an OpenRouter provider key, so every decision request resolves through the fallback path. The fallback is proven safe; live Jev quality is unproven.
3. User-space deployment is weaker isolation than the documented `agentcore` system account.
4. Host disk is at 94% (5.2 GB free on `/`) — node_modules and future releases need headroom; old releases should be pruned.
5. `AGENT_CORE_PROJECT_KEYS` lives in a 600 file owned by `prinyaroot`; if the service later moves to a dedicated account, re-issue and rotate tokens rather than copying them.
6. Rate limiting is in-process (`RateLimiter` map), so it resets on restart and does not span processes — the Cloudflare layer (B5) is the compensating control.
