#!/usr/bin/env python3
"""Tests for ops/handoff-project-token.py.

Hermetic: no ssh, no network, no real credential. A fake ssh executes the *real*
remote command text with `sh` inside a temporary sandbox, so the atomic-replace
logic (0600 temp file in the destination directory, pre-rename mode+sha256 check,
rename, cleanup) is genuinely exercised rather than mocked away.

POSIX-specific assertions (file modes, real symlinks) skip on Windows instead of
being dropped, and the refusal paths that are pure local logic run everywhere.

  python3 -m unittest discover -s ops/tests -v
  python3 -m unittest ops.tests.test_handoff_project_token -v
"""
from __future__ import annotations

import contextlib
import importlib.util
import io
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest

OPS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(OPS, "handoff-project-token.py")
IS_WINDOWS = os.name == "nt"
POSIX_ONLY = unittest.skipIf(IS_WINDOWS, "POSIX file modes/symlinks are not meaningful on Windows")

SANDBOX_ROOT = "/sbx"                       # pseudo-remote prefix, mapped into a temp dir
DEST = f"{SANDBOX_ROOT}/cfg/agent-core.token"


def have_sh() -> bool:
    if not shutil.which("sh"):
        return False
    probe = subprocess.run(["sh", "-c", "command -v stat sha256sum cut"],
                           capture_output=True, text=True)
    return probe.returncode == 0


def have_tools() -> bool:
    return have_sh()


class FakeRemote:
    """Stands in for `ssh`. Runs the remote command with sh inside `sandbox`.

    `mode_shim` rewrites the POSIX mode token in the post-write verify output on
    Windows, which cannot represent POSIX permission bits (Git Bash reports 644 for
    a file it just chmodded 600). The mode assertion itself is covered by
    `test_published_file_is_0600` (POSIX) and by the guard suite's forced-644 case;
    the shim only lets the content/atomicity assertions run on Windows too.
    """

    def __init__(self, sandbox: str, ssh_fail: bool = False, corrupt: bool = False,
                 preflight_override: str | None = None, verify_override: str | None = None,
                 mode_shim: bool = IS_WINDOWS):
        self.sandbox = sandbox.replace("\\", "/")
        self.ssh_fail = ssh_fail
        self.corrupt = corrupt
        self.preflight_override = preflight_override
        self.verify_override = verify_override
        self.mode_shim = mode_shim
        self.calls: list[tuple[str, bytes | None]] = []

    def _run(self, cmd: str, stdin_bytes: bytes | None):
        mapped = cmd.replace(SANDBOX_ROOT, self.sandbox)
        proc = subprocess.run(["sh", "-c", mapped], input=stdin_bytes, capture_output=True)
        return (proc.returncode,
                proc.stdout.decode(errors="replace"),
                proc.stderr.decode(errors="replace"))

    def dest_path(self) -> str:
        return os.path.join(self.sandbox.replace("/", os.sep), "cfg", "agent-core.token")

    def __call__(self, cmd: str, stdin_bytes: bytes | None = None):
        self.calls.append((cmd, stdin_bytes))
        if self.ssh_fail:
            return 255, "", "simulated ssh failure"

        if cmd.startswith("hostname"):
            return 0, "sandbox\nrae_admin\n1000", ""
        if "check-ignore" in cmd:
            if self.preflight_override is not None:
                return 0, self.preflight_override, ""
            # Faithful to the real preflight: report EXIST when the destination is there.
            prefix = "EXISTS\n" if os.path.exists(self.dest_path()) else ""
            return 0, prefix + "NOGITREPO\n", ""
        if stdin_bytes is None and "sha256sum" in cmd:
            if self.verify_override is not None:
                return 0, self.verify_override, ""
            rc, out, err = self._run(cmd, None)
            return rc, (self._shim_mode(out) if self.mode_shim else out), err

        if stdin_bytes is not None and self.corrupt and len(stdin_bytes) > 0:
            stdin_bytes = stdin_bytes[:-1]          # models a corrupted transfer

        return self._run(cmd, stdin_bytes)

    @staticmethod
    def _shim_mode(out: str) -> str:
        parts = out.split()
        if parts and len(parts[0]) <= 4 and parts[0].isdigit():
            parts[0] = "600"
            return " ".join(parts) + "\n"
        return out

    def temp_files(self) -> list[str]:
        base = os.path.join(self.sandbox.replace("/", os.sep), "cfg")
        if not os.path.isdir(base):
            return []
        return [f for f in os.listdir(base) if ".incoming." in f]


class HandoffHarness(unittest.TestCase):
    TOKEN = "synthetic" + "a1b2c3d4" * 8          # 64 chars, never a real credential

    def setUp(self):
        self.sandbox = tempfile.mkdtemp(prefix="handoff-test-")
        os.makedirs(os.path.join(self.sandbox, "cfg"), exist_ok=True)
        self.remote = FakeRemote(self.sandbox)
        self.module = self.load_module()
        self.patch(self.module)
        self.payload = self.TOKEN.encode()

    def tearDown(self):
        shutil.rmtree(self.sandbox, ignore_errors=True)
        os.environ.pop("HANDOFF_EXPECT_FP", None)

    # ------------------------------------------------------------------ helpers
    def load_module(self):
        spec = importlib.util.spec_from_file_location("handoff", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def patch(self, module, remote: FakeRemote | None = None):
        module.ssh = remote or self.remote
        module.load_token = lambda: (self.TOKEN, ["decision"])
        module.EXPECT_FP = module.fp(self.TOKEN)
        module.SSH_TARGET = "sandbox-target"

    def dest_path(self) -> str:
        return os.path.join(self.sandbox, "cfg", "agent-core.token")

    def write_dest(self, content: str) -> None:
        with open(self.dest_path(), "w", newline="\n") as fh:
            fh.write(content)

    def read_dest(self) -> str:
        with open(self.dest_path()) as fh:
            return fh.read()

    def run_main(self, *args, remote: FakeRemote | None = None):
        """Returns (exit_message_or_None, stdout, stderr)."""
        if remote is not None:
            self.patch(self.module, remote)
        out, err = io.StringIO(), io.StringIO()
        argv = sys.argv
        sys.argv = ["handoff", "--dest", DEST, *args]
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                try:
                    self.module.main()
                    code = None
                except SystemExit as exc:
                    code = str(exc)
        finally:
            sys.argv = argv
        return code, out.getvalue(), err.getvalue()


# --------------------------------------------------------------------------- guards
class LocalGuards(HandoffHarness):
    def test_unsafe_paths_are_refused_before_any_ssh(self):
        cases = [
            ("relative/agent-core.token", "absolute"),
            (f"{SANDBOX_ROOT}/../etc/agent-core.token", "traversal"),
            (f"{SANDBOX_ROOT}//cfg/agent-core.token", "normalised"),
            (f"{SANDBOX_ROOT}/cfg/wrong-name.txt", "end in"),
            ("/home/rae_admin/rae-attendance-v2-runtime/agent-core.token", "production runtime"),
        ]
        for dest, expected in cases:
            argv = sys.argv
            sys.argv = ["handoff", "--dest", dest, "--apply"]
            try:
                with self.assertRaises(SystemExit) as ctx:
                    self.module.main()
            finally:
                sys.argv = argv
            self.assertIn(expected, str(ctx.exception), dest)
        self.assertEqual(self.remote.calls, [], "no ssh may be attempted for a refused path")

    def test_replace_requires_apply(self):
        code, _out, err = self.run_main("--replace")
        self.assertIn("requires --apply", code + err)
        self.assertEqual(self.remote.calls, [], "no ssh may be attempted for a refused flag combo")

    def test_replace_is_refused_for_a_deny_listed_path_too(self):
        argv = sys.argv
        sys.argv = ["handoff", "--dest", "/home/rae_admin/RAE-Attendance-System-V2/agent-core.token",
                    "--apply", "--replace"]
        try:
            with self.assertRaises(SystemExit) as ctx:
                self.module.main()
        finally:
            sys.argv = argv
        self.assertIn("production runtime", str(ctx.exception))

    def test_missing_expected_fingerprint_is_refused(self):
        self.module.EXPECT_FP = ""
        code, _out, err = self.run_main("--apply")
        self.assertIn("HANDOFF_EXPECT_FP", code + err)
        self.assertEqual(self.remote.calls, [])

    def test_unexpected_rotation_is_refused(self):
        self.module.EXPECT_FP = "0" * 12
        code, _out, err = self.run_main("--apply")
        self.assertIn("unexpected rotation", code + err)
        self.assertEqual(self.remote.calls, [])


class ReportedRefusals(HandoffHarness):
    """Refusals driven by what the remote reports (runs on every platform)."""

    def test_symlink_destination_is_refused(self):
        remote = FakeRemote(self.sandbox, preflight_override="SYMLINK\nNOGITREPO\n")
        code, _out, err = self.run_main("--apply", remote=remote)
        self.assertIn("symlink", code + err)
        self.assertFalse(os.path.exists(self.dest_path()))

    def test_git_worktree_destination_is_refused(self):
        remote = FakeRemote(self.sandbox,
                            preflight_override="NOGITREPO\nGITREPO:/home/rae_admin/repo\nGITUNIGNORED\n")
        code, _out, err = self.run_main("--apply", remote=remote)
        self.assertIn("git worktree", code + err)

    def test_unusable_ssh_channel_is_refused(self):
        remote = FakeRemote(self.sandbox, ssh_fail=True)
        code, _out, err = self.run_main("--apply", remote=remote)
        self.assertIn("ssh channel unusable", code + err)
        self.assertFalse(os.path.exists(self.dest_path()))

    def test_existing_destination_is_refused_without_replace(self):
        self.write_dest("previous-value")
        code, _out, err = self.run_main("--apply")
        self.assertIn("already exists", code + err)
        self.assertEqual(self.read_dest(), "previous-value", "no overwrite without --replace")

    def test_late_verification_failure_is_reported_not_silently_accepted(self):
        remote = FakeRemote(self.sandbox, verify_override="644 rae_admin 64\n000000000000\n")
        code, _out, err = self.run_main("--apply", remote=remote)
        self.assertIn("FAILED VERIFICATION", code + err)
        self.assertNotIn("HANDOFF COMPLETE", code + err)


# --------------------------------------------------------------------------- atomicity
@unittest.skipUnless(have_tools(), "sh + coreutils are required for the remote-script tests")
class AtomicReplacement(HandoffHarness):
    def test_creates_the_destination_and_verifies_it(self):
        code, out, err = self.run_main("--apply")
        self.assertIsNone(code, out + err)
        self.assertIn("HANDOFF COMPLETE", out)
        self.assertEqual(self.read_dest(), self.TOKEN)
        self.assertEqual(self.remote.temp_files(), [], "no temp file may survive a success")

    def test_replace_swaps_an_existing_destination(self):
        self.write_dest("stale-token")
        refused, _o, err = self.run_main("--apply")
        self.assertIn("already exists", refused + err)

        code, out, err = self.run_main("--apply", "--replace")
        self.assertIsNone(code, out + err)
        self.assertIn("HANDOFF COMPLETE", out)
        self.assertEqual(self.read_dest(), self.TOKEN)
        self.assertEqual(self.remote.temp_files(), [])

    def test_failed_transfer_preserves_the_existing_destination_and_cleans_the_temp(self):
        self.write_dest("keep-me")
        remote = FakeRemote(self.sandbox, corrupt=True)
        code, out, err = self.run_main("--apply", "--replace", remote=remote)
        self.assertIn("before rename", code + err)
        self.assertEqual(self.read_dest(), "keep-me",
                         "a pre-rename failure must leave the existing token untouched")
        self.assertEqual(remote.temp_files(), [], "the temp file must be cleaned up")
        self.assertEqual(os.listdir(os.path.join(self.sandbox, "cfg")), ["agent-core.token"])

    def test_failed_transfer_on_a_fresh_destination_leaves_nothing_behind(self):
        remote = FakeRemote(self.sandbox, corrupt=True)
        code, _out, err = self.run_main("--apply", remote=remote)
        self.assertIn("before rename", code + err)
        self.assertFalse(os.path.exists(self.dest_path()), "nothing may be published")
        self.assertEqual(remote.temp_files(), [])

    @POSIX_ONLY
    def test_temp_file_is_0600_in_the_destination_directory(self):
        """Replaces the rename step with a stat of the temp file, so the pre-rename
        permission is observable instead of being cleaned up by the trap."""
        cmd = self.module.remote_write_command(
            os.path.dirname(DEST), DEST, self.module.fp(self.TOKEN), replace=False)
        probe = cmd.replace('mv -f "$tmp" "$d" || exit 27', 'stat -c "%a" "$tmp"')
        self.assertNotEqual(probe, cmd, "the rename line must have been substituted")
        proc = subprocess.run(["sh", "-c", probe.replace(SANDBOX_ROOT, self.remote.sandbox)],
                              input=self.payload, capture_output=True)
        self.assertEqual(proc.returncode, 0, proc.stderr.decode())
        self.assertEqual(proc.stdout.decode().strip(), "600")

    @POSIX_ONLY
    def test_published_file_is_0600(self):
        code, out, err = self.run_main("--apply")
        self.assertIsNone(code, out + err)
        self.assertEqual(oct(stat.S_IMODE(os.stat(self.dest_path()).st_mode))[2:], "600")

    @POSIX_ONLY
    def test_real_symlink_destination_is_refused(self):
        try:
            os.symlink(self.dest_path() + ".target", self.dest_path())
        except (OSError, NotImplementedError, AttributeError):
            self.skipTest("cannot create a symlink in this environment")
        code, _out, err = self.run_main("--apply", remote=FakeRemote(self.sandbox))
        self.assertIn("symlink", code + err)


# --------------------------------------------------------------------------- hygiene
class NoSecretLeakage(HandoffHarness):
    def test_payload_never_appears_in_output_or_argv(self):
        code, out, err = self.run_main("--apply")
        self.assertIsNone(code, out + err)
        combined = out + err
        self.assertNotIn(self.TOKEN, combined)
        self.assertNotIn(self.TOKEN[:24], combined)
        for cmd, _stdin in self.remote.calls:
            self.assertNotIn(self.TOKEN, cmd, "the payload must never be in argv")

    def test_payload_travels_on_stdin_only(self):
        self.run_main("--apply")
        writing = [stdin for _cmd, stdin in self.remote.calls if stdin is not None]
        self.assertEqual(len(writing), 1, "exactly one call may carry the payload")
        self.assertEqual(writing[0], self.payload)

    def test_a_failure_never_prints_the_payload(self):
        self.write_dest("keep-me")
        code, out, err = self.run_main("--apply", "--replace",
                                       remote=FakeRemote(self.sandbox, corrupt=True))
        self.assertNotIn(self.TOKEN, out + err)

    def test_only_fingerprints_and_metadata_are_reported(self):
        code, out, err = self.run_main("--apply")
        self.assertIsNone(code, out + err)
        self.assertIn("sha256[:12]=", out)
        self.assertIn("mode=600", out)


if __name__ == "__main__":
    unittest.main()
