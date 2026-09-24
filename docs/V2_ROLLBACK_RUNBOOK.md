# Agent Core v2 — V2-8 Rollback Runbook

Host `10.1.254.237` (`ubantu24`) · runtime `0.6.0` (release `bf08030-h1`)
Rehearsed on production 2026-09-25 02:04 (+07) — log: `~/agent-core/logs/rollback-rehearsal/20260925-020439.txt`

> Everything below runs as user `prinyaroot`. `sudo` is **not** required for the Agent Core
> rollback (user-space deployment, `systemd --user`). It is required only for the Cloudflare
> ingress file, which has narrow NOPASSWD rules.

---

## 1. Prerequisites

- SSH access to `10.1.254.237` as `prinyaroot`
- The release directories: `~/agent-core/releases/{bf08030-h1,188de03,9d2e9a9}`
- The config backup from V2-8: `~/agent-core/backups/20260925-014456/`
  (unit file, `agent-core.env`, previous release pointer, service state, previous `package-lock.json`)
- `systemctl --user` works in the session (`loginctl` shows `Linger=yes`, so units survive logout)

## 2. Current deployment

| Item | Value |
|---|---|
| Service | `agent-core.service` (systemd **user** unit), `WorkingDirectory=~/agent-core/current` |
| ExecStart | `node ~/agent-core/current/dist/src/server.js` |
| Environment file | `~/.config/agent-core/agent-core.env` (mode 600) |
| Bind | `127.0.0.1:8787` (never public) |
| Deployed SHA | release tree `bf08030-h1` = `bf08030` + browser-policy hardening + gateway browser-scope enforcement |
| Public entry | Cloudflare Tunnel `98cc1f81-c265-4c44-a61d-5271a2cad897` → `agent.raemanagemju.net` |
| Browser runtime (separate) | `agent-core-browser-mcp.service` (systemd user unit), `127.0.0.1:8791` |

## 3. Known-good deployment (rollback target)

- **Previous production release:** `~/agent-core/releases/188de03` — pre-V2 platform, version `0.2.0`,
  served 2026-09-23 → 2026-09-25 with live Jev and Cloudflare working.
- Older fallback: `~/agent-core/releases/9d2e9a9`.
- Both are complete trees (src, dist, node_modules, adapters) so a rollback needs **no build step**.

## 4. Backup paths

```
~/agent-core/backups/20260925-014456/
  agent-core.service            # systemd user unit at activation time
  agent-core.env                # runtime config incl. project tokens (mode 600, never in Git)
  cloudflare.token              # Cloudflare API token used by host tooling (mode 600)
  previous_release.txt          # /home/prinyaroot/agent-core/releases/188de03
  previous_origin_main.txt      # origin/main SHA before V2-8 work
  previous_service_state.txt    # active
  previous-package-lock.json    # lockfile of the previous release tree (repo itself has none)
```

## 5. Rollback procedure (service only — rehearse-tested)

```bash
# 0. record the current state for the incident log
readlink -f ~/agent-core/current
curl -sS http://127.0.0.1:8787/v1/health

# 1. point the symlink at the known-good release
ln -sfn ~/agent-core/releases/188de03 ~/agent-core/current

# 2. restart the control plane
systemctl --user restart agent-core.service

# 3. verify health (must return 200 and version 0.2.0 for the old release)
curl -sS http://127.0.0.1:8787/v1/health
```

Measured during the V2-8 rehearsal:

| Step | Observed |
|---|---|
| rollback to `188de03` | healthy in **1.67 s**, `version 0.2.0`, `/v2/capabilities` → 404 (V2 routes absent, as expected) |
| roll-forward to `bf08030-h1` | healthy in **0.61 s**, `version 0.6.0`, `api_versions ["v1","v2"]` |
| total switch window | **2.31 s** |

## 6. Service restart / reload

```bash
systemctl --user restart agent-core.service          # full restart (safe, ~0.6 s)
systemctl --user reload-or-restart agent-core.service # config change
systemctl --user status agent-core.service --no-pager
journalctl --user -u agent-core.service -n 200 --no-pager
```

## 7. Config rollback

```bash
# restore the previous environment file (contains project tokens: never copy into Git)
install -m 600 ~/agent-core/backups/20260925-014456/agent-core.env \
                ~/.config/agent-core/agent-core.env
systemctl --user restart agent-core.service
```

Note: V2-8 added the `browser` scope for `handbook` and `goffice2026` only, so applying the
backup env file also reverts that scope change (browser planning is not part of the pre-V2
release anyway).

## 8. Cloudflare rollback

The tunnel reads a local ingress file, so routing changes are file changes:

```bash
sudo -n cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak.$(date +%Y%m%d-%H%M%S)
# edit ingress, then:
sudo -n systemctl restart cloudflared
sudo -n journalctl -u cloudflared -n 50 --no-pager
```

Rollback of the edge layer means: no Cloudflare change was made during V2-8 (no DNS, Access, WAF or
rate-limit modification was applied), so there is nothing to revert in the edge account. The known
gap (edge rate-limit rule does not cover `/v2/*`) is a *tightening* that is still pending owner
approval; if it is later applied and must be undone, revert the rule expression in
**Security → WAF → Rate limiting rules** to the current value:

```
(starts_with(http.request.uri.path, "/control") or
 starts_with(http.request.uri.path, "/v1/advanced-route") or
 starts_with(http.request.uri.path, "/v1/context") or
 starts_with(http.request.uri.path, "/v1/control-metrics") or
 starts_with(http.request.uri.path, "/v1/decision") or
 starts_with(http.request.uri.path, "/v1/qa") or
 starts_with(http.request.uri.path, "/v1/route") or
 starts_with(http.request.uri.path, "/v1/subagent"))
```

If the whole edge path must be taken out of service, stop the tunnel instead of exposing the origin:

```bash
sudo -n systemctl stop cloudflared     # public hostname stops resolving to the origin
```

## 9. Browser runtime disable / rollback

```bash
systemctl --user stop  agent-core-browser-mcp.service
systemctl --user disable agent-core-browser-mcp.service
```

with:

- `~/agent-core/mcp-playwright/` (npx-installed `@playwright/mcp` 0.0.82)
- browser binaries in `~/.cache/ms-playwright/` (chromium 1246 + headless shell, ~1.3 GB total)
- unit file `~/.config/systemd/user/agent-core-browser-mcp.service`

Agent Core itself does not execute browser actions (`HANDOFF` only), so disabling this unit cannot
break routing, decisions or policy — only future browser handoffs.

## 10. Post-rollback health checks

```bash
curl -sS http://127.0.0.1:8787/v1/health                      # 200, expected version
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/v2/capabilities   # 401 unauth
curl -sS -o /dev/null -w '%{http_code}\n' https://agent.raemanagemju.net/control  # 302 (Access)
systemctl --user is-active agent-core.service
journalctl --user -u agent-core.service -n 50 --no-pager | grep -i error || true
```

Auth checks after any rollback (30 s, from the host):

```bash
python3 ~/agent-workspace/agent-core-v2/ops/v2-qa-live.py --base http://127.0.0.1:8787
# rolling back to 188de03 makes the /v2/* subset fail by design (routes absent) — expected
```

Policy checks after rollback to the V2 release:

```bash
python3 ~/agent-workspace/agent-core-v2/ops/v2-isolated-qa.py   # 14/14 dbplant + failure paths
node   ~/agent-workspace/agent-core-v2/ops/v2-supervisor-qa.mjs # 10/10 supervisor matrix
```

## 11. Emergency stop procedure

```bash
# 1. stop the control plane entirely (no decisions, no routing, no browser handoff)
systemctl --user stop agent-core.service
systemctl --user stop agent-core-browser-mcp.service

# 2. remove the public entry if the edge must stop too
sudo -n systemctl stop cloudflared

# 3. preserve evidence before touching anything else
cp ~/agent-core/logs/audit.jsonl /tmp/incident-audit-$(date +%Y%m%d-%H%M%S).jsonl
journalctl --user -u agent-core.service --no-pager -n 2000 > /tmp/incident-journal-$(date +%Y%m%d-%H%M%S).log
```

Stop automated changes immediately if any of the following is observed: unexpected production data
mutation, secret exposure, authentication bypass, the origin becoming publicly reachable, a dbplant
write executing autonomously, a destructive browser action, filesystem corruption, a deployment
loop, a runaway browser process or an unexpected billing spike. Then report — do not escalate to
increasingly aggressive fixes.
