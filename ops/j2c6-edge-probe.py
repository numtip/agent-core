#!/usr/bin/env python3
"""J2-C6: (1) read the CF service-token inventory, (2) prove the operator's credential is
admitted by Cloudflare Access at the edge BEFORE any policy change.

Read-only w.r.t. Cloudflare. No secret is printed: the credential travels in a 0600 header
file inside a 0700 temp dir which is shredded on exit.
"""
import json
import os
import re
import shutil
import subprocess
import tempfile
import urllib.error
import urllib.request


def _required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"REFUSING: set {name} (not stored in Git)")
    return value

ACC = _required_env("CF_ACCOUNT_ID")
API = "https://agent.raemanagemju.net"
BUNDLE = os.path.expanduser("~/.config/agent-core/cf-access.env")
CFTOK = os.path.expanduser("~/.config/agent-core/cloudflare.token")

kv = {}
for ln in open(BUNDLE):
    if "=" in ln:
        k, v = ln.split("=", 1)
        kv[k.strip()] = v.strip()
cid, csec = kv["CF_ACCESS_CLIENT_ID"], kv["CF_ACCESS_CLIENT_SECRET"]
print(f"credential: client_id len={len(cid)} ends_with_access={cid.endswith('.access')} "
      f"secret len={len(csec)} charset={sorted(set(re.sub(r'[A-Za-z0-9_-]', '', csec))) or 'A-Za-z0-9_-'}")


def cf(path):
    r = urllib.request.Request(os.environ.get("CF_API_BASE", "https://api.cloudflare.com/client/v4") + path)
    r.add_header("authorization", "Bearer " + open(CFTOK).read().strip())
    r.add_header("user-agent", "agent-core-ops/1.0")
    try:
        with urllib.request.urlopen(r, timeout=25) as x:
            return x.status, json.loads(x.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


print("\n== [1] Cloudflare service-token inventory (read-only) ==")
s, b = cf(f"/accounts/{ACC}/access/service_tokens")
toks = b.get("result") or []
print(f"HTTP {s} count={len(toks) if s == 200 else 'n/a'} errors={json.dumps(b.get('errors'))[:120]}")
for t in toks:
    print("  ", json.dumps({k: t.get(k) for k in ("id", "name", "expires_at", "created_at")}))
    print("   client_id matches bundle:", t.get("client_id") == cid)

print("\n== [2] synthetic edge probe with the operator credential (no project token) ==")
d = tempfile.mkdtemp()
os.chmod(d, 0o700)
try:
    hp = os.path.join(d, "cf.hdr")
    with open(hp, "w") as fh:
        fh.write(f"CF-Access-Client-Id: {cid}\nCF-Access-Client-Secret: {csec}\n")
    os.chmod(hp, 0o600)
    body = json.dumps({"project": "rae-attendance-v2", "task_id": "J2C6-EDGE-PROBE",
                       "decision_type": "NEXT_ACTION", "state": {"simulated": True},
                       "question": {"type": "choice", "instructions": "probe only",
                                    "criteria": {"A": "a", "B": "b"}},
                       "fallback_result": "A"})
    cp = subprocess.run(["curl", "-sS", "-4", "--max-time", "30", "-o", os.path.join(d, "body"),
                         "-w", "%{http_code}", "-H", "@" + hp, "-H", "content-type: application/json",
                         "-H", "x-agent-project: rae-attendance-v2", "-d", body, f"{API}/v1/decision"],
                        capture_output=True, text=True)
    code = cp.stdout.strip()
    body_path = os.path.join(d, "body")
    got = open(body_path).read()[:200] if os.path.exists(body_path) else f"<no body; curl rc={cp.returncode}>"
    layer = "ACCESS(edge)" if "Cloudflare Access" in got else ("APP" if got.strip().startswith("{") else "?")
    print(f"HTTP {code} layer={layer} body={got!r}")
    verdict = "PASS (edge admitted the credential -> app answered)" if layer == "APP" else "FAIL"
    print(f"edge admission: {verdict}")
finally:
    for f in os.listdir(d):
        try:
            subprocess.run(["shred", "-u", os.path.join(d, f)], check=False, capture_output=True)
        except Exception:
            pass
    shutil.rmtree(d, ignore_errors=True)
    print(f"header file shredded and temp dir removed: {not os.path.exists(d)}")
