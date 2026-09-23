#!/usr/bin/env bash
# Agent Core — promote a git ref to production (user-space layout on host 237).
#
#   bash ops/promote-release.sh [git-ref]        # default: origin/main
#
# Steps: resolve SHA -> gate (install/audit/test/build) -> stage release with production
# dependencies -> repoint ~/agent-core/current -> restart the user unit -> verify health and
# a live decision -> print rollback. Never prints secrets.
set -euo pipefail

SRC="$HOME/agent-workspace/agent-core"
BASE="$HOME/agent-core"
REF="${1:-origin/main}"
SERVICE=agent-core.service

cd "$SRC"
ORIG_BRANCH=$(git rev-parse --abbrev-ref HEAD)
trap 'git -C "$SRC" checkout --quiet "$ORIG_BRANCH" 2>/dev/null || true' EXIT
git fetch --quiet origin
SHA=$(git rev-parse --short "$REF")
FULL=$(git rev-parse "$REF")
echo "== promoting $REF -> release $SHA ($FULL)"

echo "-- fetching/checking out the ref in a detached worktree-free way (build from the clone)"
git checkout --quiet --detach "$REF"

echo "-- gates"
npm install --no-fund --no-audit --silent
npm audit --omit=dev --audit-level=high
npm test --silent 2>&1 | tail -4
npm run build

echo "-- staging release $SHA"
REL="$BASE/releases/$SHA"
if [ -d "$REL" ]; then
  echo "   release dir exists, refreshing dist + dependencies"
  rm -rf "$REL/dist" "$REL/node_modules"
else
  mkdir -p "$REL"
  cp -a "$SRC/package.json" "$SRC/package-lock.json" "$SRC/adapters" "$SRC/deploy" \
        "$SRC/docs" "$SRC/schemas" "$SRC/templates" "$REL/" 2>/dev/null || true
fi
cp -a "$SRC/dist" "$REL/dist"
( cd "$REL" && npm install --omit=dev --no-fund --no-audit --silent )
echo "$FULL" > "$REL/RELEASE_SHA"

PREV=$(basename "$(readlink -f "$BASE/current")")
ln -sfn "releases/$SHA" "$BASE/current"
echo "-- current: $(readlink -f "$BASE/current")  (previous release: $PREV)"

echo "-- restarting $SERVICE"
systemctl --user restart "$SERVICE"
sleep 3
systemctl --user is-active "$SERVICE"

echo "-- verify"
curl -sS http://127.0.0.1:8787/v1/health; echo
python3 - "$PREV" <<'PY'
import json, os, sys, urllib.request, urllib.error
env = {}
for line in open(os.path.expanduser("~/.config/agent-core/agent-core.env")):
    line = line.strip()
    if line and not line.startswith("#") and "=" in line:
        k, v = line.split("=", 1)
        env[k] = v
keys = json.loads(env["AGENT_CORE_PROJECT_KEYS"])
body = {"project": "52clips", "task_id": "PROMOTE-SMOKE", "decision_type": "NEXT_ACTION",
        "state": {"visual": "ready", "audio": "ready", "subtitle": "missing"},
        "question": {"type": "choice", "instructions": "Choose the next safe production action.",
                     "criteria": {"GENERATE_SUBTITLE": "Required subtitle is missing.",
                                  "READY_FOR_QA": "All required assets are present.",
                                  "HUMAN_REVIEW": "State is ambiguous."}},
        "fallback_result": "HUMAN_REVIEW"}
req = urllib.request.Request("http://127.0.0.1:8787/v1/decision", method="POST",
                             data=json.dumps(body).encode(),
                             headers={"Content-Type": "application/json",
                                      "x-agent-project": "52clips",
                                      "x-agent-project-token": keys["52clips"]})
try:
    with urllib.request.urlopen(req, timeout=120) as r:
        d = json.loads(r.read().decode())
    print("live decision:", {k: d.get(k) for k in ("result", "confidence", "disposition",
                                                   "fallback", "reason_code", "provider_request_id")})
    ok = not d.get("fallback") and isinstance(d.get("confidence"), (int, float))
    print("PROMOTION VERIFY:", "PASS" if ok else "FAIL (still falling back)")
except urllib.error.HTTPError as e:
    print("decision HTTP", e.code, e.read().decode()[:150])
    print("PROMOTION VERIFY: FAIL")
PY

cat <<ROLLBACK

== rollback ==
  ln -sfn releases/$PREV $BASE/current && systemctl --user restart $SERVICE
  # or fully:  systemctl --user disable --now $SERVICE && rm -rf $BASE ~/.config/agent-core
ROLLBACK
