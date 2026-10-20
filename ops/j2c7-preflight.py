#!/usr/bin/env python3
"""J2-C7 preflight: (1) snapshot integrity, (2) drift check across all 5 Access apps,
(3) confirm the machine policy is still the broad selector, (4) show the exact Shape A
payload that WOULD be sent (token_id unresolved -> not sent). Read-only."""
import json
import os
import re
import subprocess
import time
import urllib.request


def _required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"REFUSING: set {name} (not stored in Git)")
    return value

ACC = _required_env("CF_ACCOUNT_ID")
MACHINE = _required_env("CF_MACHINE_APP_ID")
POLICY = _required_env("CF_MACHINE_POLICY_ID")
SNAP = os.path.expanduser(_required_env("CF_ACCESS_SNAPSHOT_DIR"))
CFTOK = os.path.expanduser("~/.config/agent-core/cloudflare.token")
tok = open(CFTOK).read().strip()


def api(path):
    r = urllib.request.Request(os.environ.get("CF_API_BASE", "https://api.cloudflare.com/client/v4") + path)
    r.add_header("authorization", "Bearer " + tok)
    r.add_header("user-agent", "agent-core-ops/1.0")
    with urllib.request.urlopen(r, timeout=25) as x:
        return json.loads(x.read().decode())["result"]


print("== [1] snapshot integrity ==")
cp = subprocess.run(["sha256sum", "-c", "SHA256SUMS"], cwd=SNAP, capture_output=True, text=True)
ok = cp.stdout.count(": OK")
snapshot_intact = cp.returncode == 0 and ok > 0
print(f"files OK: {ok}  (exit {cp.returncode})  intact={snapshot_intact}")
snap_apps = json.load(open(f"{SNAP}/apps.json"))
print(f"snapshot apps: {len(snap_apps)}")

print("\n== [2] drift check: live vs snapshot (all apps, all policies) ==")
live_apps = api(f"/accounts/{ACC}/access/apps")
drift = []
if {a["id"] for a in live_apps} != {a["id"] for a in snap_apps}:
    drift.append("app id set changed")
for a in sorted(live_apps, key=lambda x: x["id"]):
    aid = a["id"]
    snap_file = f"{SNAP}/policies-{aid}.json"
    if not os.path.exists(snap_file):
        drift.append(f"{a.get('name')} ({aid}) not in snapshot")
        print(f"  {(a.get('name') or '')[:34]:36s} NOT IN SNAPSHOT")
        continue
    s = json.load(open(snap_file))
    l = api(f"/accounts/{ACC}/access/apps/{aid}/policies")
    # compare the fields that matter, per policy id
    def norm(pol):
        return {p["id"]: {k: p.get(k) for k in ("name", "decision", "precedence", "include",
                                                "exclude", "require", "reusable")} for p in pol}
    same = norm(l) == norm(s)
    tag = "same" if same else "DRIFT"
    if not same:
        drift.append(f"{a.get('name')} ({aid})")
    print(f"  {(a.get('name') or '')[:34]:36s} live={len(l)} snapshot={len(s)} {tag}")

print("\n== [3] machine policy now ==")
pol = api(f"/accounts/{ACC}/access/apps/{MACHINE}/policies")
for p in pol:
    print(f"  {p['name']} | decision={p['decision']} | precedence={p['precedence']} | include={json.dumps(p['include'])}")
broad = any("any_valid_service_token" in x for p in pol for x in p.get("include", []))
print(f"  broad selector still present: {broad}")

print("\n== [4] what Shape A would send (token_id NOT yet supplied) ==")
uuid_re = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)
cand = os.environ.get("TOKEN_UUID", "").strip()
print(f"  TOKEN_UUID env supplied: {bool(cand)}  well-formed_uuid: {bool(uuid_re.match(cand)) if cand else False}")
matches = [p for p in pol if p["id"] == POLICY]
if not matches:
    raise SystemExit(f"STOP: machine policy {POLICY} not found on app {MACHINE} — APPLY READY: False")
base = matches[0]
body = {"name": base["name"], "decision": base["decision"], "precedence": base["precedence"],
        "exclude": base["exclude"], "require": base["require"], "reusable": base["reusable"],
        "include": [{"service_token": {"token_id": cand or "<MISSING>"}}]}
print("  payload keys preserved:", sorted(body))
print("  include ->", json.dumps(body["include"]))
ready = bool(cand and uuid_re.match(cand)) and not drift and snapshot_intact
print(f"\nDRIFT: {drift or 'none'}  |  SNAPSHOT INTACT: {snapshot_intact}  |  APPLY READY: {ready}")
print(f"checked at {time.strftime('%Y-%m-%d %H:%M:%S%z')}")
