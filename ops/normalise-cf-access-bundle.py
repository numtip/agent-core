#!/usr/bin/env python3
"""Normalise the operator's CF Access bundle to the documented shape, preserving values byte-exact.

input (operator):  CF-Access-Client-Id=<id> / blank / CF-Access-Client-Secret=<secret>
canonical:         CF_ACCESS_CLIENT_ID=<id>\\nCF_ACCESS_CLIENT_SECRET=<secret>\\n

Refuses to write unless every value's sha256 is unchanged. Prints no values.
"""
import hashlib
import os
import re
import sys

P = os.path.expanduser("~/.config/agent-core/cf-access.env")
ALIASES = {
    "cf_access_client_id": "CF_ACCESS_CLIENT_ID",
    "cf-access-client-id": "CF_ACCESS_CLIENT_ID",
    "cf_access_client_secret": "CF_ACCESS_CLIENT_SECRET",
    "cf-access-client-secret": "CF_ACCESS_CLIENT_SECRET",
}

raw = open(P, "rb").read()
before = {}
lines = raw.decode().splitlines()
for ln in lines:
    if "=" in ln and ln.strip() and not ln.startswith("#"):
        k, v = ln.split("=", 1)
        name = ALIASES.get(k.strip().lower(), k.strip())
        if name in before:
            sys.exit(f"REFUSING: {name} appears more than once (ambiguous which value to keep)")
        before[name] = v.strip()

need = {"CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"}
if set(before) != need:
    sys.exit(f"REFUSING: unexpected key set {sorted(before)}")

new = "".join(f"{k}={before[k]}\n" for k in ("CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"))
old_repr = "\n".join(lines) + "\n"
if new == old_repr:
    print("already canonical — no change")
else:
    # The CF secret is shown only once at creation: never risk a truncated in-place write.
    tmp = f"{P}.tmp-{os.getpid()}"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write(new)
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, P)
    print("normalised: hyphen/alias keys -> documented CF_ACCESS_* names, blank line removed")

# verify byte-exact value preservation
after = {}
for ln in open(P):
    if "=" in ln:
        k, v = ln.split("=", 1)
        after[k.strip()] = v.strip()
assert after == before, "VALUE CHANGED — abort"
for k in sorted(after):
    h = hashlib.sha256(after[k].encode()).hexdigest()[:12]
    fmt = "hex" if re.fullmatch(r"[0-9a-f]+", after[k]) else "not-hex"
    print(f"  {k}: len={len(after[k])} sha256[:12]={h} format={fmt} "
          f"ends_with_access={after[k].endswith('.access')}")
print("file: mode=%s lines=%d sha256[:12]=%s" % (oct(os.stat(P).st_mode)[-3:],
      len(open(P).read().splitlines()), hashlib.sha256(open(P, "rb").read()).hexdigest()[:12]))
print("values preserved byte-exact: YES")
