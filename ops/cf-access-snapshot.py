#!/usr/bin/env python3
"""Capture the pre-change Cloudflare Access state (rollback source). READ-ONLY.

Writes to ~/agent-core/backups/cloudflare-access-<ts>/ :
  apps.json            every Access app in the account
  policies-<appid>.json  policies per app (the rollback source for a policy edit)
  service-tokens.json  the service-token inventory (secrets stripped if ever present)
  MANIFEST.json        what was captured, when, and the sha256 of each file
  SHA256SUMS

Prints only counts, ids and hashes - never a credential value.
"""
import hashlib
import json
import os
import socket
import time
import urllib.error
import urllib.request


def _required_env(name):
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"REFUSING: set {name} (not stored in Git)")
    return value

TOKEN_FILE = os.path.expanduser("~/.config/agent-core/cloudflare.token")
ACC = _required_env("CF_ACCOUNT_ID")
CF = os.environ.get("CF_API_BASE", "https://api.cloudflare.com/client/v4")
OUT_ROOT = os.path.expanduser(os.environ.get("CF_ACCESS_BACKUP_ROOT", "~/agent-core/backups"))

tok = open(TOKEN_FILE).read().strip()


def api(path):
    req = urllib.request.Request(CF + path)
    req.add_header("authorization", f"Bearer {tok}")
    req.add_header("user-agent", "agent-core-ops/1.0")
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}


def strip_secrets(obj):
    """Defence in depth: never persist a credential-looking field."""
    if isinstance(obj, dict):
        return {k: ("<stripped>" if k.lower() in ("client_secret", "client_secret_value", "secret")
                    else strip_secrets(v)) for k, v in obj.items()}
    if isinstance(obj, list):
        return [strip_secrets(v) for v in obj]
    return obj


ts = time.strftime("%Y%m%d-%H%M%S")
out = os.path.join(OUT_ROOT, f"cloudflare-access-{ts}")
os.makedirs(out, mode=0o700, exist_ok=True)

written = []
failures = []
s, apps = api(f"/accounts/{ACC}/access/apps")
if s != 200:
    failures.append(f"apps HTTP {s}")
apps = apps.get("result", []) if s == 200 else []
with open(f"{out}/apps.json", "w") as fh:
    json.dump(strip_secrets(apps), fh, indent=2, sort_keys=True)
written.append("apps.json")
print(f"apps: HTTP {s} count={len(apps)}")

for a in apps:
    aid = a.get("id")
    s2, pol = api(f"/accounts/{ACC}/access/apps/{aid}/policies")
    body = pol.get("result", []) if s2 == 200 else {"error": pol.get("errors"), "http": s2}
    if s2 != 200:
        failures.append(f"policies {aid} HTTP {s2}")
    name = f"policies-{aid}.json"
    with open(f"{out}/{name}", "w") as fh:
        json.dump(strip_secrets(body), fh, indent=2, sort_keys=True)
    written.append(name)
    n = len(body) if isinstance(body, list) else "err"
    print(f"  {(a.get('name') or '')[:36]:38s} {aid} policies={n} HTTP {s2}")

s3, st = api(f"/accounts/{ACC}/access/service_tokens")
if s3 != 200:
    failures.append(f"service_tokens HTTP {s3}")
tokens = st.get("result", []) if s3 == 200 else []
with open(f"{out}/service-tokens.json", "w") as fh:
    json.dump(strip_secrets(tokens), fh, indent=2, sort_keys=True)
written.append("service-tokens.json")
print(f"service tokens: HTTP {s3} count={len(tokens)}")

manifest = {
    "captured_at": ts,
    "captured_on": socket.gethostname(),
    "account_id": ACC,
    "purpose": "pre-change rollback source for the rae-attendance-v2-qa-190 machine-client Access change",
    "read_only": True,
    "complete": not failures,
    "failures": failures,
    "files": {},
    "notes": [
        "service_tokens list never contains client_secret; any client_secret key is stripped defensively",
        "a service token's client_secret is shown only once by Cloudflare at creation time and is NOT recoverable",
        "restore = PUT the captured policy JSON back onto its app id, then verify with a live probe",
    ],
}
for f in written:
    h = hashlib.sha256(open(os.path.join(out, f), "rb").read()).hexdigest()
    manifest["files"][f] = {"sha256": h, "bytes": os.path.getsize(os.path.join(out, f))}
with open(f"{out}/MANIFEST.json", "w") as fh:
    json.dump(manifest, fh, indent=2, sort_keys=True)

lines = [f"{v['sha256']}  {k}" for k, v in sorted(manifest["files"].items())]
with open(f"{out}/SHA256SUMS", "w") as fh:
    fh.write("\n".join(lines) + "\n")

print(f"\nSNAPSHOT: {out} (mode {oct(os.stat(out).st_mode)[-3:]})")
for k, v in sorted(manifest["files"].items()):
    print(f"  {v['sha256'][:16]}  {v['bytes']:6d}  {k}")
print(f"  MANIFEST+SUMS written; SHA256SUMS self-hash: "
      f"{hashlib.sha256(open(out + '/SHA256SUMS', 'rb').read()).hexdigest()[:16]}")
if failures:
    raise SystemExit(f"INCOMPLETE SNAPSHOT — NOT a valid rollback source: {failures}")
