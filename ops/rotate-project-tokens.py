#!/usr/bin/env python3
"""Rotate Agent Core project tokens in the protected env file.
Prints only counts and SHA-256 fingerprints — never token values.
Usage: python3 ops/rotate-project-tokens.py [--keep-existing-audit]
"""
from __future__ import annotations

import hashlib
import json
import os
import secrets
import subprocess
import sys

ENV_FILE = os.path.expanduser("~/.config/agent-core/agent-core.env")
PROJECTS = ["52clips", "attendance-report-generator", "handbook", "goffice2026", "dbplant"]

if not os.path.exists(ENV_FILE):
    sys.exit(f"FAIL: {ENV_FILE} not found")

lines = open(ENV_FILE).read().splitlines()
keys = json.loads(next(l.split("=", 1)[1] for l in lines if l.startswith("AGENT_CORE_PROJECT_KEYS=")))
old_fp = {p: hashlib.sha256(keys[p].encode()).hexdigest()[:8] for p in keys if p in keys}

new_keys = {p: secrets.token_hex(32) for p in PROJECTS}
out = []
for line in lines:
    if line.startswith("AGENT_CORE_PROJECT_KEYS="):
        out.append("AGENT_CORE_PROJECT_KEYS=" + json.dumps(new_keys, separators=(",", ":")))
    else:
        out.append(line)
open(ENV_FILE, "w").write("\n".join(out) + "\n")
os.chmod(ENV_FILE, 0o600)

print(f"rotated {len(new_keys)} project tokens (mode {oct(os.stat(ENV_FILE).st_mode)[-3:]})")
for p in PROJECTS:
    print(f"  {p:32s} new=sha256:{hashlib.sha256(new_keys[p].encode()).hexdigest()[:8]} "
          f"prev=sha256:{old_fp.get(p, 'n/a')}")

subprocess.run(["systemctl", "--user", "restart", "agent-core.service"], check=True)
import time
time.sleep(3)
print("service:", subprocess.run(["systemctl", "--user", "is-active", "agent-core.service"],
                                 capture_output=True, text=True).stdout.strip())
