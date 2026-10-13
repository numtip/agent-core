#!/usr/bin/env python3
"""Runnable guard checks for ops/handoff-project-token.py (no ssh, no secret, no writes).

  python3 test_handoff_guards.py
"""
import importlib.util
import hashlib
import os
import sys

SPEC = os.path.join(os.path.dirname(os.path.abspath(__file__)), "handoff-project-token.py")
spec = importlib.util.spec_from_file_location("handoff", SPEC)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)  # importing does not run main()


def refused(dest):
    return bool(mod.check_dest(dest))


CASES = [
    ("/home/rae_admin/.config/rae-attendance-v2-qa/agent-core.token", False),   # approved path shape
    ("relative/agent-core.token", True),                                        # must be absolute
    ("/home/rae_admin/../etc/agent-core.token", True),                          # traversal
    ("/tmp/agent-core.token", False),                                           # absolute, not a runtime
    ("/home/rae_admin/x/wrong-name.txt", True),                                 # wrong basename
    ("/home/rae_admin/rae-attendance-v2-runtime/agent-core.token", True),       # production runtime
    ("/home/rae_admin/RAE-Attendance-System-V2/agent-core.token", True),        # production runtime
    ("/home/rae_admin//rae-attendance-v2-runtime/agent-core.token", True),      # '//' deny-list bypass
    ("/home/rae_admin/./rae-attendance-v2-runtime/agent-core.token", True),     # '/./' deny-list bypass
    ("/home/rae_admin/rae-attendance-v2-runtime-qa/agent-core.token", False),   # sibling dir, not the runtime
]

# ---- end-to-end path with a stubbed ssh: proves the value travels on stdin and
# ---- that a bad post-write verification is reported as a failure, not success.
DEST = "/home/rae_admin/.config/rae-attendance-v2-qa/agent-core.token"
SENT = {}


def run_apply(fake_verify_out, extra_argv=()):
    SENT.clear()

    def fake_ssh(cmd, stdin_bytes=None):
        if stdin_bytes is not None:
            SENT["stdin"] = stdin_bytes
            return 0, "", ""
        if "hostname" in cmd:
            return 0, "raeserver\nrae_admin\n1000", ""
        if "check-ignore" in cmd:
            return 0, "NOGITREPO\n", ""
        if "sha256sum" in cmd:
            return 0, fake_verify_out, ""
        return 0, "", ""

    mod.ssh = fake_ssh
    mod.load_token = lambda: ("a" * 64, ["decision"])
    mod.EXPECT_FP = mod.fp("a" * 64)
    argv, sys.argv = sys.argv, ["handoff", "--dest", DEST, "--apply", *extra_argv]
    try:
        mod.main()
        return None
    except SystemExit as e:
        return str(e)
    finally:
        sys.argv = argv


def path_checks():
    bad = 0
    for dest, expect_refuse in CASES:
        got, ok = refused(dest), None
        ok = got == expect_refuse
        bad += not ok
        print(f"[{'PASS' if ok else 'FAIL'}] refuse={got} expect_refuse={expect_refuse}  {dest}")
    assert refused("relative/x") and not refused(DEST)
    return bad


def path_checks_e2e():
    bad = 0
    dummy = "a" * 64
    expect_fp = mod.fp(dummy)  # computed here: main() patches EXPECT_FP to the same value

    # 1. good verify -> success, and the token must have gone over stdin (never argv)
    out = run_apply(f"600 rae_admin 64\n{expect_fp}\n")
    ok = out is None and SENT.get("stdin") == dummy.encode() and dummy not in " ".join(sys.argv)
    bad += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] e2e good: stdin carried the value, argv did not, exit 0 ({out})")

    # 2. wrong fingerprint on the remote -> must exit non-zero, never claim success
    out = run_apply("600 rae_admin 64\n000000000000\n")
    ok = out is not None and "FAILED VERIFICATION" in out
    bad += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] e2e bad fingerprint rejected")

    # 3. wrong mode on the remote -> must exit non-zero
    out = run_apply(f"644 rae_admin 64\n{expect_fp}\n")
    ok = out is not None and "FAILED VERIFICATION" in out
    bad += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] e2e wrong mode rejected")

    # 4. empty verify output (ssh failed) -> must exit non-zero
    out = run_apply("")
    ok = out is not None
    bad += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] e2e empty verify rejected")

    # 5. --src-file mode: a 2-line secret bundle must ship byte-exact over stdin
    import tempfile
    bundle = b"CF_ACCESS_CLIENT_ID=x.access\nCF_ACCESS_CLIENT_SECRET=y\n"
    fd, path = tempfile.mkstemp()
    os.write(fd, bundle)
    os.close(fd)
    os.chmod(path, 0o600)
    exp = hashlib.sha256(bundle).hexdigest()[:12]
    out = run_apply(f"600 rae_admin {len(bundle)}\n{exp}\n", extra_argv=["--src-file", path])
    ok = out is None and SENT.get("stdin") == bundle
    bad += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] src-file: exact bytes over stdin, exit 0 ({out})")

    # 6. a world-readable source file must be refused
    os.chmod(path, 0o644)
    out = run_apply(f"600 rae_admin {len(bundle)}\n{exp}\n", extra_argv=["--src-file", path])
    ok = out is not None and "mode 600" in out
    bad += not ok
    print(f"[{'PASS' if ok else 'FAIL'}] src-file with mode 644 refused ({out})")
    os.remove(path)
    return bad


if __name__ == "__main__":
    fails = path_checks() + path_checks_e2e()
    total = len(CASES) + 6
    print(f"\n{total - fails}/{total} checks PASS")
    sys.exit(1 if fails else 0)
