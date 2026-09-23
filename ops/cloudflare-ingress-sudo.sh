#!/usr/bin/env bash
# Agent Core — add the Cloudflare Tunnel ingress entry for agent.raemanagemju.net.
# RUN AS ROOT:  sudo bash ops/cloudflare-ingress-sudo.sh
#
# Safe by construction: backs up the live config, inserts one entry before the catch-all,
# validates the full config, verifies that the existing production hostnames still route,
# and only then restarts cloudflared.
set -euo pipefail

CONFIG="${AGENT_CORE_CF_CONFIG:-/etc/cloudflared/config.yml}"
HOSTNAME="agent.raemanagemju.net"
ORIGIN="http://127.0.0.1:8787"
TS="$(date +%Y%m%d_%H%M%S)"
BACKUP="$CONFIG.bak.agent-core-$TS"
DRY_RUN=0
[ -n "${AGENT_CORE_CF_CONFIG:-}" ] && DRY_RUN=1   # override path => rehearsal, no restart

[ "$(id -u)" -eq 0 ] || [ "$DRY_RUN" -eq 1 ] || { echo "FAIL: run with sudo"; exit 1; }
[ -f "$CONFIG" ] || { echo "FAIL: $CONFIG not found"; exit 1; }

cp -a "$CONFIG" "$BACKUP"
echo "backup: $BACKUP"

if grep -q "hostname: $HOSTNAME" "$CONFIG"; then
  echo "ingress for $HOSTNAME already present — nothing to insert"
else
  python3 - "$CONFIG" "$HOSTNAME" "$ORIGIN" <<'PY'
import sys
path, hostname, origin = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path).read().splitlines()
entry = [f"  - hostname: {hostname}", f"    service: {origin}"]
out, inserted = [], False
for line in lines:
    stripped = line.strip()
    if not inserted and stripped.startswith("- service: http_status:404"):
        out.extend(entry)
        inserted = True
    out.append(line)
if not inserted:          # no catch-all found: append the entry at the end
    out.extend(entry)
open(path, "w").write("\n".join(out) + "\n")
print("inserted" if inserted else "appended")
PY
fi

echo "== validate =="
cloudflared tunnel --config "$CONFIG" ingress validate

echo "== routing resolution =="
for h in agent.raemanagemju.net webhook.raemanagemju.net ssh.raemanagemju.net \
         handbook.raemanagemju.net litellm.raemanagemju.net raemanagemju.net; do
  printf '%-32s -> ' "$h"
  cloudflared tunnel --config "$CONFIG" ingress rule "https://$h" | tr '\n' ' ' | sed 's/  */ /g'
  echo
done

echo "== restart cloudflared =="
if [ "$DRY_RUN" -eq 1 ]; then
  echo "dry-run (config override): skipping restart of the live cloudflared service"
else
  systemctl restart cloudflared
  sleep 5
  systemctl is-active cloudflared
  if ! systemctl is-active --quiet cloudflared; then
    echo "FAIL: cloudflared did not come back — restoring $BACKUP"
    cp -a "$BACKUP" "$CONFIG"
    systemctl restart cloudflared
    exit 1
  fi
  journalctl -u cloudflared --since "-60s" --no-pager | grep -iE "error|fail" | tail -5 || echo "no error lines in the last 60s"
fi

echo "== origin check through the tunnel path (loopback origin) =="
curl -sS -o /dev/null -w 'origin health http=%{http_code}\n' http://127.0.0.1:8787/v1/health

cat <<ROLLBACK

=== ROLLBACK ===
  sudo cp -a $BACKUP $CONFIG && sudo systemctl restart cloudflared
=== NOTE ===
DNS for $HOSTNAME is created separately by ops/cloudflare-edge.py --apply (needs an API token),
and Cloudflare Access must be attached before this hostname can be considered protected.
ROLLBACK
