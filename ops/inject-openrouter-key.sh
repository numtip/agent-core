#!/usr/bin/env bash
# Inject the existing on-host OpenRouter key into the Agent Core runtime env file.
# Prints NO secret material (only lengths and a truncated SHA-256 fingerprint).
set -euo pipefail

SRC="${INJECT_SRC:-$HOME/agent-workspace/tools/jev/.env}"
DEST="${INJECT_DEST:-$HOME/.config/agent-core/agent-core.env}"

[ -f "$SRC" ] || { echo "FAIL: source env not found: $SRC"; exit 1; }
[ -f "$DEST" ] || { echo "FAIL: destination env not found: $DEST"; exit 1; }

KEY="$(grep -m1 '^OPENROUTER_API_KEY=' "$SRC" | cut -d= -f2- | tr -d '"'"'"' ')"
[ -n "$KEY" ] || { echo "FAIL: no OPENROUTER_API_KEY in $SRC"; exit 1; }

# Pass the key via the environment, never argv (argv is world-readable in /proc/<pid>/cmdline).
INJECT_KEY="$KEY" python3 - "$DEST" <<'PY'
import hashlib, os, sys
dest, key = sys.argv[1], os.environ.pop("INJECT_KEY")
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
tmp = f"{dest}.tmp-{os.getpid()}"
fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w") as fh:
    fh.write("\n".join(out) + "\n")
os.replace(tmp, dest)
print("key_len=%d fingerprint=sha256:%s" % (len(key), hashlib.sha256(key.encode()).hexdigest()[:8]))
PY

chmod 600 "$DEST"
echo "env updated: $DEST (mode $(stat -c '%a' "$DEST"))"
[ "${INJECT_NO_RESTART:-0}" = "1" ] && { echo "service: not restarted (INJECT_NO_RESTART=1)"; exit 0; }
systemctl --user restart agent-core.service
sleep 3
echo "service: $(systemctl --user is-active agent-core.service)"
curl -sS http://127.0.0.1:8787/v1/health | python3 -c 'import json,sys; d=json.load(sys.stdin); print("health:", {k:d[k] for k in ("status","service","auth_required","provider_configured","jev_model")})'
