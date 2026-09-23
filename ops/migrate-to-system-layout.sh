#!/usr/bin/env bash
# Agent Core — migrate the user-space runtime to the documented root-owned layout.
# RUN AS ROOT:  sudo bash ops/migrate-to-system-layout.sh
#
# Creates/does:
#   * system account `agentcore`
#   * /opt/agent-core/releases/<release> + /opt/agent-core/current
#   * /etc/agent-core/agent-core.env  (root:agentcore 0640, secrets copied, never printed)
#   * /var/lib/agent-core, /var/log/agent-core
#   * system unit agent-core.service (Node 22 runtime, loopback bind)
#   * stops the user-space unit first so port 8787 is free
#
# Leaves ~/agent-core and the user unit in place so rollback is a two-command revert.
set -euo pipefail

USER_HOME="/home/prinyaroot"
USER_NAME="prinyaroot"
SRC_LINK="$USER_HOME/agent-core/current"
SRC_ROOT="$USER_HOME/agent-core"
ENV_SRC="$USER_HOME/.config/agent-core/agent-core.env"
DEF_NODE="/usr/local/agent-core-node"
OPT="/opt/agent-core"
ETC="/etc/agent-core"
LOG="/var/log/agent-core"
LIB="/var/lib/agent-core"
UNIT="/etc/systemd/system/agent-core.service"

[ "$(id -u)" -eq 0 ] || { echo "FAIL: run with sudo"; exit 1; }
[ -L "$SRC_LINK" ] || { echo "FAIL: user-space release not found at $SRC_LINK"; exit 1; }
[ -f "$ENV_SRC" ] || { echo "FAIL: runtime env not found at $ENV_SRC"; exit 1; }

REL="$(basename "$(readlink -f "$SRC_LINK")")"
echo "release to promote: $REL"

echo "== 1. service account =="
if id "$USER_NAME" >/dev/null 2>&1; then :; fi
if ! id agentcore >/dev/null 2>&1; then
  useradd --system --home-dir "$LIB" --shell /usr/sbin/nologin agentcore
  echo "created system user agentcore"
else
  echo "system user agentcore already exists"
fi

echo "== 2. Node 22 runtime =="
NODE_BIN=""
if [ -x /usr/bin/node ] && [ "$(/usr/bin/node -p 'process.versions.node.split(".")[0]')" -ge 22 ]; then
  NODE_BIN="/usr/bin/node"
else
  if [ ! -x "$DEF_NODE/bin/node" ]; then
    mkdir -p "$DEF_NODE"
    cp -a /home/prinyaroot/.nvm/versions/node/v22.22.2/. "$DEF_NODE/"
    echo "installed Node 22 runtime at $DEF_NODE (no change to the system nodejs package)"
  fi
  NODE_BIN="$DEF_NODE/bin/node"
fi
echo "node: $NODE_BIN ($("$NODE_BIN" --version))"

echo "== 3. directories and release =="
mkdir -p "$OPT/releases" /var/log/agent-core /var/lib/agent-core
if [ -d "$OPT/releases/$REL" ]; then
  echo "release already present: $REL"
else
  cp -a "$SRC_ROOT/releases/$REL" "$OPT/releases/$REL"
fi
ln -sfn "releases/$REL" "$OPT/current"
chown -R agentcore:agentcore "$OPT"
chmod -R a-w "$OPT/releases/$REL" 2>/dev/null || true
chown agentcore:agentcore "$LOG" "$LIB"
chmod 750 "$LOG" "$LIB"
echo "layout: $OPT/current -> releases/$REL"

echo "== 4. protected runtime env =="
mkdir -p "$ETC"
python3 - "$ENV_SRC" "$ETC/agent-core.env" <<'PY'
import shutil, sys
src, dst = sys.argv[1], sys.argv[2]
lines = []
for line in open(src).read().splitlines():
    if line.startswith("AGENT_CORE_AUDIT_LOG="):
        lines.append("AGENT_CORE_AUDIT_LOG=/var/log/agent-core/audit.jsonl")
    else:
        lines.append(line)
open(dst, "w").write("\n".join(lines) + "\n")
print("env written:", dst)
PY
chown root:agentcore "$ETC/agent-core.env"
chmod 640 "$ETC/agent-core.env"
echo "env perms: $(stat -c '%U:%G %a' "$ETC/agent-core.env")"

echo "== 5. system unit =="
install -m 0644 "$OPT/current/deploy/systemd/agent-core.service" "$UNIT"
python3 - "$UNIT" "$NODE_BIN" <<'PY'
import re, sys
path, node = sys.argv[1], sys.argv[2]
text = open(path).read()
text = re.sub(r"^ExecStart=.*$", f"ExecStart={node} /opt/agent-core/current/dist/src/server.js",
              text, flags=re.M)
open(path, "w").write(text)
print("ExecStart:", [l for l in text.splitlines() if l.startswith("ExecStart=")][0])
PY

echo "== 6. stop user-space runtime to free 127.0.0.1:8787 =="
runuser -u "$USER_NAME" -- env XDG_RUNTIME_DIR=/run/user/1000 \
  systemctl --user disable --now agent-core.service || echo "(user unit was not active)"

echo "== 7. start system service =="
systemctl daemon-reload
systemctl enable --now agent-core.service
sleep 4
systemctl is-active agent-core.service
ss -lntp | grep 8787 || true

echo "== 8. verification =="
curl -sS http://127.0.0.1:8787/v1/health || true
echo
systemctl status agent-core.service --no-pager | head -12

cat <<'ROLLBACK'

=== ROLLBACK (restores the previous user-space runtime) ===
  sudo systemctl disable --now agent-core.service
  sudo rm -f /etc/systemd/system/agent-core.service && sudo systemctl daemon-reload
  runuser -u prinyaroot -- env XDG_RUNTIME_DIR=/run/user/1000 systemctl --user enable --now agent-core.service
To go back to an earlier release instead of the user-space runtime:
  sudo ln -sfn releases/<previous-release-id> /opt/agent-core/current && sudo systemctl restart agent-core.service
ROLLBACK
