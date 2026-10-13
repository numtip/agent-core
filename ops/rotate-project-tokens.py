#!/usr/bin/env python3
"""Rotate Agent Core project tokens in the protected env file.
Prints only counts and SHA-256 fingerprints — never token values.

Every project already present in AGENT_CORE_PROJECT_KEYS is rotated (plus the
baseline PROJECTS list), so no onboarded project is ever dropped.

Usage: python3 ops/rotate-project-tokens.py [--dry-run] [--no-restart]
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import subprocess
import sys
import time

ENV_FILE = os.path.expanduser("~/.config/agent-core/agent-core.env")
PROJECTS = ["52clips", "attendance-report-generator", "handbook", "goffice2026", "dbplant"]


def fp(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:8]


def atomic_write(path: str, text: str) -> None:
    tmp = f"{path}.tmp-{os.getpid()}"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--dry-run", action="store_true", help="show what would rotate; write nothing")
    ap.add_argument("--no-restart", action="store_true", help="do not restart agent-core.service")
    a = ap.parse_args()

    if not os.path.exists(ENV_FILE):
        sys.exit(f"FAIL: {ENV_FILE} not found")

    lines = open(ENV_FILE).read().splitlines()
    key_lines = [l for l in lines if l.startswith("AGENT_CORE_PROJECT_KEYS=")]
    if len(key_lines) != 1:
        sys.exit(f"FAIL: expected exactly one AGENT_CORE_PROJECT_KEYS line, found {len(key_lines)}")
    keys = json.loads(key_lines[0].split("=", 1)[1])
    old_fp = {p: fp(v) for p, v in keys.items()}

    projects = list(dict.fromkeys([*keys, *PROJECTS]))
    if a.dry_run:
        print(f"DRY RUN — would rotate {len(projects)} project tokens; nothing written")
        for p in projects:
            print(f"  {p:32s} prev=sha256:{old_fp.get(p, 'n/a')}")
        return

    new_keys = {p: secrets.token_hex(32) for p in projects}
    out = [("AGENT_CORE_PROJECT_KEYS=" + json.dumps(new_keys, separators=(",", ":")))
           if l.startswith("AGENT_CORE_PROJECT_KEYS=") else l for l in lines]
    atomic_write(ENV_FILE, "\n".join(out) + "\n")

    print(f"rotated {len(new_keys)} project tokens (mode {oct(os.stat(ENV_FILE).st_mode)[-3:]})")
    for p in projects:
        print(f"  {p:32s} new=sha256:{fp(new_keys[p])} prev=sha256:{old_fp.get(p, 'n/a')}")

    if a.no_restart:
        print("service: not restarted (--no-restart)")
        return
    subprocess.run(["systemctl", "--user", "restart", "agent-core.service"], check=True)
    time.sleep(3)
    print("service:", subprocess.run(["systemctl", "--user", "is-active", "agent-core.service"],
                                     capture_output=True, text=True).stdout.strip())


if __name__ == "__main__":
    main()
