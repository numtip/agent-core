#!/usr/bin/env bash
# Agent Core — user-space activation (no sudo required on host 237).
# Idempotent: existing secrets/env are preserved. NEVER prints secret values.
set -euo pipefail

NODE_BIN="$(command -v node)"
BASE="$HOME/agent-core"
CONF_DIR="$HOME/.config/agent-core"
ENV_FILE="$CONF_DIR/agent-core.env"
UNIT_DIR="$HOME/.config/systemd/user"
UNIT_FILE="$UNIT_DIR/agent-core.service"
LOG_DIR="$BASE/logs"
DATA_DIR="$BASE/data"

mkdir -p "$CONF_DIR" "$UNIT_DIR" "$LOG_DIR" "$DATA_DIR"
chmod 700 "$CONF_DIR"

if [ ! -f "$ENV_FILE" ]; then
  python3 - "$ENV_FILE" <<'PY'
import json, secrets, sys
path = sys.argv[1]
projects = ["52clips", "attendance-report-generator", "handbook", "goffice2026", "dbplant"]
scopes = {
    "52clips": ["decision", "route", "qa", "context", "metrics"],
    "attendance-report-generator": ["decision", "route", "qa", "context"],
    "handbook": ["decision", "route", "qa", "context"],
    "goffice2026": ["decision", "route", "qa", "context", "metrics"],
    "dbplant": ["decision", "context"],
}
keys = {p: secrets.token_hex(32) for p in projects}
lines = [
    "# Agent Core runtime configuration (protection: chmod 640 equivalent, owner-only)",
    "AGENT_CORE_ENV=production",
    "AGENT_CORE_HOST=127.0.0.1",
    "AGENT_CORE_PORT=8787",
    "AGENT_CORE_AUTH_REQUIRED=true",
    "",
    "# Provider secret — injected later by operator; do not commit",
    "OPENROUTER_API_KEY=",
    "OPENROUTER_DECISIONS_URL=https://openrouter.ai/api/alpha/decisions",
    "OPENROUTER_TIMEOUT_MS=8000",
    "",
    "CONFIDENCE_EXECUTE=0.85",
    "CONFIDENCE_REVIEW=0.60",
    "",
    "AGENT_CORE_RATE_LIMIT_MAX=100",
    "AGENT_CORE_RATE_LIMIT_WINDOW_MS=60000",
    "",
    f"AGENT_CORE_AUDIT_LOG={path.rsplit('/',2)[0]}/../agent-core/logs/audit.jsonl",
    "",
    "AGENT_CORE_PROJECT_KEYS=" + json.dumps(keys, separators=(",", ":")),
    "AGENT_CORE_PROJECT_SCOPES=" + json.dumps(scopes, separators=(",", ":")),
]
with open(path, "w") as fh:
    fh.write("\n".join(lines) + "\n")
print("generated env with %d project identities, token length=%d chars each" % (len(keys), 64))
PY
  chmod 600 "$ENV_FILE"
  echo "created: $ENV_FILE (mode $(stat -c '%a' "$ENV_FILE"))"
else
  chmod 600 "$ENV_FILE"
  echo "kept existing: $ENV_FILE (mode $(stat -c '%a' "$ENV_FILE"))"
fi

# Audit log path fix (absolute, since /var/log/agent-core requires sudo)
python3 - "$ENV_FILE" "$LOG_DIR" <<'PY'
import sys
env_path, log_dir = sys.argv[1], sys.argv[2]
target = f"AGENT_CORE_AUDIT_LOG={log_dir}/audit.jsonl"
out = []
for line in open(env_path).read().splitlines():
    out.append(target if line.startswith("AGENT_CORE_AUDIT_LOG=") else line)
open(env_path, "w").write("\n".join(out) + "\n")
PY

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=Agent Core Shared AI Decision Platform (user-space)
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$BASE/current
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $BASE/current/dist/src/server.js
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now agent-core.service
sleep 2
systemctl --user is-active agent-core.service
echo "node=$NODE_BIN  unit=$UNIT_FILE"
