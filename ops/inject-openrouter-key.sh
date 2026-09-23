#!/usr/bin/env bash
# Inject the existing on-host OpenRouter key into the Agent Core runtime env file.
# Prints NO secret material (only lengths and a truncated SHA-256 fingerprint).
set -euo pipefail

SRC="/home/prinyaroot/agent-workspace/tools/jev/.env"
DEST="/home/prinyaroot/.config/agent-core/agent-core.env"

[ -f "$SRC" ] || { echo "FAIL: source env not found: $SRC"; exit 1; }
[ -f "$DEST" ] || { echo "FAIL: destination env not found: $DEST"; exit 1; }

KEY="$(grep -m1 '^OPENROUTER_API_KEY=' "$SRC" | cut -d= -f2- | tr -d '"'"'"' ')"
[ -n "$KEY" ] || { echo "FAIL: no OPENROUTER_API_KEY in $SRC"; exit 1; }

python3 - "$DEST" "$KEY" <<'PY'
import hashlib, sys
dest, key = sys.argv[1], sys.argv[2]
out = []
seen = False
for line in open(dest).read().splitlines():
    if line.startswith("OPENROUTER_API_KEY="):
        out.append("OPENROUTER_API_KEY=" + key)
        seen = True
    else:
        out.append(line)
if not seen:
    out.append("OPENROUTER_API_KEY=" + key)
open(dest, "w").write("\n".join(out) + "\n")
print("key_len=%d fingerprint=sha256:%s" % (len(key), hashlib.sha256(key.encode()).hexdigest()[:8]))
PY

chmod 600 "$DEST"
echo "env updated: $DEST (mode $(stat -c '%a' "$DEST"))"
systemctl --user restart agent-core.service
sleep 3
echo "service: $(systemctl --user is-active agent-core.service)"
curl -sS http://127.0.0.1:8787/v1/health | python3 -c 'import json,sys; d=json.load(sys.stdin); print("health:", {k:d[k] for k in ("status","service","auth_required","provider_configured","jev_model")})'
