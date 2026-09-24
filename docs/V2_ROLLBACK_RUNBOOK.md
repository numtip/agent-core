# Agent Core v2 — V2-8 Rollback Runbook

Host `10.1.254.237` (`ubantu24`) · runtime `0.6.0` (release `fca4f8f`, merged `main`)
Rehearsed on production 2026-09-25 02:04 **and** 02:26 (+07)
Logs: `~/agent-core/logs/rollback-rehearsal/20260925-020439.txt`, `…20260925-022617.txt`

> Everything below runs as user `prinyaroot`. `sudo` is **not** required for an Agent Core
> rollback (user-space deployment + `systemd --user`). It is required only for the Cloudflare
> ingress file, which has narrow NOPASSWD rules.

---

## 1. Prerequisites

- SSH access to `10.1.254.237` as `prinyaroot`
- Release directories: `~/agent-core/releases/{fca4f8f,bf08030-h1,188de03,9d2e9a9}`
- Config/deployment backup: `~/agent-core/backups/20260925-014456/`
  (unit file, `agent-core.env`, release pointer, service state, previous lockfile)
- Cloudflare rule backup: `~/agent-core/backups/cloudflare-ratelimit-20260925-021304.json`
- Browser runtime unit backup: `~/agent-core/backups/agent-core-browser-mcp.service.pre-v28b`
- `systemctl --user` works in the session (`Linger=yes`)

## 2. Current deployment

| Item | Value |
|---|---|
| Service | `agent-core.service` (systemd **user** unit), `WorkingDirectory=~/agent-core/current` |
| Environment | `~/.config/agent-core/agent-core.env` (600) — includes the MCP settings |
| Bind | `127.0.0.1:8787` (never public) |
| Release | `fca4f8f` (= merged `main`: hardening + live browser execution) |
| Public entry | Cloudflare Tunnel `98cc1f81-…` → `agent.raemanagemju.net`; edge rule covers `/control`, `/v1/*`, `/v2/*` |
| Browser runtime | `agent-core-browser-mcp.service`, `127.0.0.1:8791` (kill switch `PLAYWRIGHT_MCP_EXECUTION_ENABLED=true`) |

## 3. Known-good deployments (rollback targets)

| Release | Contents | Verified |
|---|---|---|
| `bf08030-h1` | V2 control plane **without** the browser execution route (`/v2/browser/execute` → 404) | healthy in 0.59 s during the second rehearsal |
| `188de03` | pre-V2 platform (`0.2.0`), served 2026-09-23 → 09-25 | healthy in 1.67 s during the first rehearsal |
| `9d2e9a9` | older pre-V2 tree | kept as a last-resort tree |

All are complete trees (src, dist, node_modules, adapters) — a rollback needs **no build step**.

## 4. Rollback procedure (rehearsed twice)

```bash
# 0. record state
readlink -f ~/agent-core/current
curl -sS http://127.0.0.1:8787/v1/health

# 1. previous release (V2 without browser execution)
ln -sfn ~/agent-core/releases/bf08030-h1 ~/agent-core/current
systemctl --user restart agent-core.service
curl -sS http://127.0.0.1:8787/v1/health              # 200, version 0.6.0
curl -sS -o /dev/null -w '%{http_code}\n' -X POST http://127.0.0.1:8787/v2/browser/execute \
  -H 'content-type: application/json' -d '{"project":"handbook","url":"https://example.com/","action":"BROWSER_READ"}'   # 404 (route absent)

# 2. full pre-V2 rollback if the V2 plane itself must go
ln -sfn ~/agent-core/releases/188de03 ~/agent-core/current
systemctl --user restart agent-core.service
curl -sS http://127.0.0.1:8787/v1/health              # 200, version 0.2.0, no v2 API
```

Measured:

| Step | Result |
|---|---|
| rollback → `bf08030-h1` | healthy **0.59 s**, `/v2/browser/execute` 404 |
| roll-forward → `fca4f8f` | healthy **0.59 s** |
| total switch window | **1.21 s** |
| (first rehearsal) → `188de03` / roll-forward | 1.67 s / 0.61 s, window 2.31 s |

## 5. Rolling back only the browser execution (recommended first move)

```bash
# immediate: no new code, no restart of the API needed for the effect on new requests
systemctl --user stop agent-core-browser-mcp.service

# or disable the feature through config (survives restarts)
#   PLAYWRIGHT_MCP_EXECUTION_ENABLED=false   in ~/.config/agent-core/agent-core.env
systemctl --user restart agent-core.service

# belt and braces: both
systemctl --user stop agent-core-browser-mcp.service
```

Verified behaviour with the runtime stopped (rehearsal 02:26): the API answered
`503 {"error":"MCP_UNAVAILABLE","reason":"MCP transport error: fetch failed","executed":false}` in
**54 ms** — nothing executed, no hang, and the policy plan was still reported. The kill switch alone
produces `200 READY executed=false reason=MCP_EXECUTION_DISABLED` (verified on instance 8801).
Runtime restart after the rehearsal took 4.2 s (`systemctl --user start agent-core-browser-mcp.service`).

## 6. Config rollback

```bash
install -m 600 ~/agent-core/backups/20260925-014456/agent-core.env ~/.config/agent-core/agent-core.env
systemctl --user restart agent-core.service
```

Note: that backup predates the `browser` scope for `handbook`/`goffice2026` and the
`PLAYWRIGHT_MCP_*` keys, so restoring it also disables browser planning/execution for those projects.

## 7. Cloudflare edge rollback

The tunnel reads a local ingress file (no edge routing change was made in this round):

```bash
sudo -n cp /etc/cloudflared/config.yml /etc/cloudflared/config.yml.bak.$(date +%Y%m%d-%H%M%S)
# edit ingress, then
sudo -n systemctl restart cloudflared && sudo -n journalctl -u cloudflared -n 50 --no-pager
```

The rate-limit expression was widened this round to include `/v2/`. To revert it exactly:

1. Restore the previous rule body from `~/agent-core/backups/cloudflare-ratelimit-20260925-021304.json`
   (zone `raemanagemju.net`, ruleset `103bc20746c540f6986fb0d6f34102ad`, phase `http_ratelimit`).
2. Apply with `PUT /zones/{zone_id}/rulesets/phases/http_ratelimit/entrypoint` and the `rules` array
   from that backup (`PATCH` is rejected for token auth: HTTP 405 / code 10405).
3. Verify: rule description `agent-core-edge-volumetric-backstop-100-per-10s-per-ip`,
   `block`, 100 req / 10 s per `cf.colo.id + ip.src`, expression ending at `/v1/subagent`.

To take the edge out entirely (instead of exposing the origin):

```bash
sudo -n systemctl stop cloudflared     # public hostname stops serving; origin stays loopback-only
```

## 8. Browser runtime disable / rollback

```bash
systemctl --user stop    agent-core-browser-mcp.service
systemctl --user disable agent-core-browser-mcp.service
```

with:

- `~/agent-core/mcp-playwright/` (`@playwright/mcp` 0.0.82)
- browser binaries in `~/.cache/ms-playwright/` (chromium 1246 + headless shell, ~1.3 GB)
- unit `~/.config/systemd/user/agent-core-browser-mcp.service` (backup: `~/agent-core/backups/agent-core-browser-mcp.service.pre-v28b`)

## 9. Post-rollback health checks

```bash
curl -sS http://127.0.0.1:8787/v1/health                                  # 200, expected version
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8787/v2/capabilities   # 401 unauth
curl -sS -o /dev/null -w '%{http_code}\n' https://agent.raemanagemju.net/control  # 302 (Access)
systemctl --user is-active agent-core.service agent-core-browser-mcp.service
journalctl --user -u agent-core.service -n 50 --no-pager | grep -i error || true
```

Full suites after any rollback (paths assume the working copy at `~/agent-workspace/agent-core-v2`):

```bash
python3 ops/v2-qa-live.py        # /v2/* subset fails by design if you rolled back to a pre-V2 release
python3 ops/v2-isolated-qa.py    # dbplant policy + failure paths
node    ops/v2-supervisor-qa.mjs # supervisor matrix
python3 ops/v2-edge-qa.py        # public edge behaviour (normal, auth, burst, recovery)
```

## 10. Emergency stop procedure

```bash
# 1. stop execution surfaces first, then the control plane
systemctl --user stop agent-core-browser-mcp.service
systemctl --user stop agent-core.service

# 2. stop the public entry if the edge must go too
sudo -n systemctl stop cloudflared

# 3. preserve evidence before any other change
cp ~/agent-core/logs/audit.jsonl /tmp/incident-audit-$(date +%Y%m%d-%H%M%S).jsonl
journalctl --user -u agent-core.service --no-pager -n 3000 > /tmp/incident-journal-$(date +%Y%m%d-%H%M%S).log
```

Stop automated changes immediately on: unexpected production data mutation, secret exposure,
authentication bypass, the origin becoming publicly reachable, an autonomous dbplant write, a
destructive browser action, filesystem corruption, a deployment loop, a runaway browser process, or
an unexpected billing spike. Preserve evidence and report — do not escalate into aggressive fixes.
