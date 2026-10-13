#!/usr/bin/env python3
"""Validate the operator-provided CF Access credential bundle WITHOUT printing values."""
import os
import stat
import hashlib

P = os.path.expanduser("~/.config/agent-core/cf-access.env")
print("path:", P)
if not os.path.exists(P):
    raise SystemExit("ABSENT — no approved operator input yet")

st = os.stat(P)
mode = oct(st.st_mode)[-3:]
print(f"mode={mode} owner_uid={st.st_uid} (expect 1000) size={st.st_size}")

raw = open(P, "rb").read()
lines = raw.decode().splitlines()
crlf = b"\r" in raw
trailing_nl = raw.endswith(b"\n")
print(f"lines={len(lines)} crlf_present={crlf} trailing_newline={trailing_nl}")

keys, problems = [], []
for i, ln in enumerate(lines, 1):
    if not ln.strip():
        problems.append(f"line {i}: blank")
        continue
    if ln.startswith("#"):
        problems.append(f"line {i}: comment")
        continue
    if "=" not in ln:
        problems.append(f"line {i}: no '='")
        continue
    k, v = ln.split("=", 1)
    keys.append(k)
    print(f"  line {i}: key={k} value_len={len(v)} sha256[:12]={hashlib.sha256(v.encode()).hexdigest()[:12]}")

expected = {"CF_ACCESS_CLIENT_ID", "CF_ACCESS_CLIENT_SECRET"}
print("key set:", sorted(keys))
if set(keys) != expected:
    problems.append(f"key set mismatch: {sorted(set(keys) ^ expected)}")
if mode != "600":
    problems.append(f"mode is {mode}, must be 600")
if st.st_uid != os.getuid():
    problems.append(f"owner uid {st.st_uid} != current uid")
if len(lines) != 2:
    problems.append(f"expected exactly 2 lines, got {len(lines)}")

if len(keys) != len(set(keys)):
    problems.append("duplicate keys")
if crlf:
    problems.append("CRLF line endings")
vals = [l.split("=", 1)[1].strip() for l in lines
        if "=" in l and l.strip() and not l.startswith("#")]
empty = [k for k, v in zip(keys, vals) if not v]
print("empty values:", empty or "none")
if empty:
    problems.append(f"empty values: {empty}")
print("bundle sha256[:12]:", hashlib.sha256(raw).hexdigest()[:12])
print("VERDICT:", "PASS" if not problems else "FAIL")
for p in problems:
    print("  problem:", p)
raise SystemExit(0 if not problems else 1)
