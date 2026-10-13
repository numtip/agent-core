#!/usr/bin/env python3
"""J2-C8: verify the Shape A change field-by-field against the snapshot (read-only)."""
import json
import os
import urllib.request


def _required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"REFUSING: set {name} (not stored in Git)")
    return value

ACC = _required_env("CF_ACCOUNT_ID")
MACHINE = _required_env("CF_MACHINE_APP_ID")
SNAP = os.path.expanduser(_required_env("CF_ACCESS_SNAPSHOT_DIR"))
tok = open(os.path.expanduser("~/.config/agent-core/cloudflare.token")).read().strip()


def api(p):
    r = urllib.request.Request(os.environ.get("CF_API_BASE", "https://api.cloudflare.com/client/v4") + p)
    r.add_header("authorization", "Bearer " + tok)
    r.add_header("user-agent", "agent-core-ops/1.0")
    with urllib.request.urlopen(r, timeout=25) as x:
        return json.loads(x.read().decode())["result"]


before = json.load(open(f"{SNAP}/policies-{MACHINE}.json"))[0]
matches = [p for p in api(f"/accounts/{ACC}/access/apps/{MACHINE}/policies")
           if p["id"] == before["id"]]
if not matches:
    raise SystemExit(f"SHAPE_A INVARIANTS: FAIL — policy {before['id']} no longer exists on {MACHINE}")
after = matches[0]
include = after.get("include") or []

FIELDS = ("name", "decision", "precedence", "include", "exclude", "require", "reusable")
print("== policy diff (snapshot -> live), field by field ==")
changed = []
for f in FIELDS:
    b, a = before.get(f), after.get(f)
    mark = "same" if b == a else "CHANGED"
    if b != a:
        changed.append(f)
    print(f"  {f:11s} {mark:8s} before={json.dumps(b)}" + ("" if b == a else f"  after={json.dumps(a)}"))

print(f"\nchanged fields: {changed}")
print(f"broad selector present now: {any('any_valid_service_token' in x for x in include)}")
print(f"pinned selector present now: {any('service_token' in x for x in include)}")
print(f"token_id: {include[0].get('service_token', {}).get('token_id') if include else None}")
print(f"include entry count: {len(include)} (expect 1)")

ok = (changed == ["include"] and after.get("name") == before.get("name")
      and after.get("decision") == "non_identity" and after.get("precedence") == before.get("precedence")
      and not after.get("exclude") and not after.get("require")
      and len(include) == 1 and "service_token" in include[0]
      and "any_valid_service_token" not in json.dumps(include))
print(f"\nSHAPE_A INVARIANTS: {'PASS' if ok else 'FAIL'}")

# also confirm every OTHER app is untouched vs snapshot
apps = api(f"/accounts/{ACC}/access/apps")
print("\n== cross-app consistency ==")
all_same = True
for a in sorted(apps, key=lambda x: x["id"]):
    snap_file = f"{SNAP}/policies-{a['id']}.json"
    if not os.path.exists(snap_file):
        all_same = False
        print(f"  {(a.get('name') or '')[:34]:36s} NOT IN SNAPSHOT (new app)")
        continue
    s = json.load(open(snap_file))
    l = api(f"/accounts/{ACC}/access/apps/{a['id']}/policies")
    def n(p):
        return {x["id"]: {k: x.get(k) for k in ("name", "decision", "precedence", "include",
                                                "exclude", "require", "reusable")} for x in p}
    same = n(l) == n(s)
    is_machine = a["id"] == MACHINE
    state = "intended change" if (is_machine and not same) else ("same" if same else "UNEXPECTED DRIFT")
    if not same and not is_machine:
        all_same = False
    print(f"  {(a.get('name') or '')[:34]:36s} {state}")
print(f"\ncross-app drift outside the plan: {'NONE' if all_same else 'FOUND — STOP'}")
raise SystemExit(0 if ok and all_same else 1)
