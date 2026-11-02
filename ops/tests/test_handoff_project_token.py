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
        try:
            proc = subprocess.run(["sh", "-c", mapped], input=stdin_bytes, capture_output=True)
        except OSError as exc:                                        # pragma: no cover
            return 255, "", f"could not run sh ({exc.__class__.__name__})"
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
            # Run the REAL preflight text. A hardcoded reply cannot detect a real
            # symlink, which is why the symlink case previously passed only on Windows
            # (where it is skipped) and failed on Linux.
            return self._run(cmd, None)
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
        self.real_ssh = module.ssh
        self.real_load_token = module.load_token
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

    def run_cli_main(self, *args, remote: FakeRemote | None = None):
        """Like run_main, but through cli() so the returned exit code is observable."""
        if remote is not None:
            self.patch(self.module, remote)
        out, err = io.StringIO(), io.StringIO()
        argv = sys.argv
        sys.argv = ["handoff", "--dest", DEST, *args]
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = self.module.cli()
        finally:
            sys.argv = argv
        return code, out.getvalue(), err.getvalue()

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

        code, out, err = self.run_main("--apply", "--replace", "--confirm-replace")
        self.assertIsNone(code, out + err)
        self.assertIn("HANDOFF COMPLETE", out)
        self.assertEqual(self.read_dest(), self.TOKEN)
        self.assertEqual(self.remote.temp_files(), [])

    def test_failed_transfer_preserves_the_existing_destination_and_cleans_the_temp(self):
        self.write_dest("keep-me")
        remote = FakeRemote(self.sandbox, corrupt=True)
        code, out, err = self.run_main("--apply", "--replace", "--confirm-replace",
                                       remote=remote)
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
        code, out, err = self.run_main("--apply", "--replace", "--confirm-replace",
                                       remote=FakeRemote(self.sandbox, corrupt=True))
        self.assertNotIn(self.TOKEN, out + err)

    def test_only_fingerprints_and_metadata_are_reported(self):
        code, out, err = self.run_main("--apply")
        self.assertIsNone(code, out + err)
        self.assertIn("sha256[:12]=", out)
        self.assertIn("mode=600", out)


class TruncatingStream:
    """A stdout that stops accepting writes once `allow_lines` newlines have gone out.

    This models `| head -1` closing the pipe. Counting logical lines (not write() calls)
    keeps the behaviour stable regardless of how print() chunks its output.
    """

    def __init__(self, allow_lines: int):
        self.allow_lines = allow_lines
        self.lines = 0
        self.text = ""

    def write(self, s: str) -> int:
        if self.lines > self.allow_lines:
            raise BrokenPipeError(32, "Broken pipe (simulated: the reader closed the pipe)")
        self.text += s
        self.lines += s.count("\n")
        if self.lines > self.allow_lines:
            raise BrokenPipeError(32, "Broken pipe (simulated: the reader closed the pipe)")
        return len(s)

    def flush(self) -> None:
        pass


class ReplacementConfirmation(HandoffHarness):
    """`--apply --replace` alone must never overwrite a live credential.

    This is the incident's exact command line: it must now refuse before any ssh call.
    """

    def test_apply_replace_without_confirmation_is_refused_before_any_ssh(self):
        self.write_dest("live-credential")
        code, _out, err = self.run_main("--apply", "--replace")
        self.assertIn("explicit confirmation", code + err)
        self.assertIn("no ssh call was made", code + err)
        self.assertEqual(self.remote.calls, [], "no ssh may be attempted before confirmation")
        self.assertEqual(self.read_dest(), "live-credential",
                         "the live credential must be untouched")

    def test_confirmation_flag_allows_the_replace(self):
        self.write_dest("live-credential")
        code, out, err = self.run_main("--apply", "--replace", "--confirm-replace")
        self.assertIsNone(code, out + err)
        self.assertEqual(self.read_dest(), self.TOKEN)

    def test_env_confirmation_must_match_the_exact_destination(self):
        self.write_dest("live-credential")
        os.environ["HANDOFF_CONFIRM_REPLACE"] = "/some/other/path/agent-core.token"
        try:
            code, _out, err = self.run_main("--apply", "--replace")
        finally:
            os.environ.pop("HANDOFF_CONFIRM_REPLACE", None)
        self.assertIn("explicit confirmation", code + err)
        self.assertEqual(self.read_dest(), "live-credential")

    def test_env_confirmation_with_the_exact_path_allows_the_replace(self):
        self.write_dest("live-credential")
        os.environ["HANDOFF_CONFIRM_REPLACE"] = DEST
        try:
            code, out, err = self.run_main("--apply", "--replace")
        finally:
            os.environ.pop("HANDOFF_CONFIRM_REPLACE", None)
        self.assertIsNone(code, out + err)
        self.assertEqual(self.read_dest(), self.TOKEN)

    def test_a_fresh_create_does_not_need_confirmation(self):
        code, out, err = self.run_main("--apply")
        self.assertIsNone(code, out + err)
        self.assertEqual(self.read_dest(), self.TOKEN)

    def test_dry_run_still_needs_no_confirmation_and_writes_nothing(self):
        self.write_dest("live-credential")
        code, out, err = self.run_main("--replace")
        self.assertIn("requires --apply", code + err)
        self.assertEqual(self.read_dest(), "live-credential")
        self.assertEqual(self.remote.calls, [])

    def test_verify_only_refuses_to_be_combined_with_a_write(self):
        code, _out, err = self.run_main("--verify-only", "--apply", "--replace",
                                        "--confirm-replace")
        self.assertIn("--verify-only is read-only", code + err)
        self.assertEqual(self.remote.calls, [], "a read-only run must not call ssh")

    def test_replace_confirmed_but_dry_run_still_writes_nothing(self):
        self.write_dest("live-credential")
        code, out, err = self.run_main("--replace", "--confirm-replace")
        self.assertIn("requires --apply", code + err)
        self.assertEqual(self.read_dest(), "live-credential")


class PipeClosureIsNotADryRun(HandoffHarness):
    """`| head -1` truncates the report; it does not undo anything and is not a dry run."""

    def run_with_truncated_stdout(self, allow_lines: int, *args, remote=None):
        if remote is not None:
            self.patch(self.module, remote)
        stream = TruncatingStream(allow_lines)
        err = io.StringIO()
        argv = sys.argv
        sys.argv = ["handoff", "--dest", DEST, *args]
        try:
            with contextlib.redirect_stdout(stream), contextlib.redirect_stderr(err):
                code = self.module.cli()
        finally:
            sys.argv = argv
        return code, stream.text, err.getvalue()

    def test_pipe_closed_after_the_write_reports_the_write_may_have_happened(self):
        code, _out, err = self.run_with_truncated_stdout(3, "--apply")
        self.assertEqual(code, self.module.EXIT_PIPE, err)
        self.assertIn("NOT A DRY RUN", err)
        self.assertIn("may already have been performed", err)
        self.assertIn("--verify-only", err)
        # The write really did happen: this is the whole point.
        self.assertEqual(self.read_dest(), self.TOKEN, "the credential was delivered")
        writes = [stdin for _cmd, stdin in self.remote.calls if stdin is not None]
        self.assertEqual(len(writes), 1, "the payload went out exactly once")

    def test_pipe_closed_before_the_write_leaves_the_destination_untouched(self):
        code, _out, err = self.run_with_truncated_stdout(1, "--apply")
        self.assertEqual(code, self.module.EXIT_PIPE, err)
        self.assertIn("NOT A DRY RUN", err)
        self.assertFalse(os.path.exists(self.dest_path()), "nothing was published")
        writes = [stdin for _cmd, stdin in self.remote.calls if stdin is not None]
        self.assertEqual(writes, [], "the payload never went out")

    def test_pipe_closed_during_a_replace_still_warns(self):
        self.write_dest("live-credential")
        code, _out, err = self.run_with_truncated_stdout(3, "--apply", "--replace",
                                                         "--confirm-replace")
        self.assertEqual(code, self.module.EXIT_PIPE, err)
        self.assertIn("NOT A DRY RUN", err)

    def test_a_clean_run_returns_zero_and_no_warning(self):
        code, out, err = self.run_with_truncated_stdout(999, "--apply")
        self.assertEqual(code, self.module.EXIT_OK, err)
        self.assertIn("HANDOFF COMPLETE", out)
        self.assertNotIn("NOT A DRY RUN", err)


class InterruptedRun(HandoffHarness):
    def test_keyboard_interrupt_during_the_write_is_not_a_silent_success(self):
        class InterruptingRemote(FakeRemote):
            def __call__(self, cmd, stdin_bytes=None):
                if stdin_bytes is not None:
                    raise KeyboardInterrupt
                return super().__call__(cmd, stdin_bytes)

        code, out, err = self.run_cli_main("--apply", remote=InterruptingRemote(self.sandbox))
        self.assertEqual(code, self.module.EXIT_INTERRUPTED, err)
        self.assertIn("NOT A DRY RUN", err)
        self.assertNotIn("HANDOFF COMPLETE", out)

    def test_ssh_mid_run_failure_refuses_and_leaves_nothing(self):
        class FailingMidway(FakeRemote):
            def __call__(self, cmd, stdin_bytes=None):
                if stdin_bytes is not None:
                    return 255, "", "connection closed by remote host"
                return super().__call__(cmd, stdin_bytes)

        code, _out, err = self.run_cli_main("--apply", remote=FailingMidway(self.sandbox))
        self.assertNotEqual(code, self.module.EXIT_OK)
        self.assertIn("before rename", err)
        self.assertFalse(os.path.exists(self.dest_path()))

    def test_unrunnable_ssh_binary_is_reported_not_a_traceback(self):
        """Exercises the real ssh() wrapper with subprocess failing to start ssh.

        The fake ssh is removed first, otherwise the wrapper under test is never reached.
        """
        real_run = self.module.subprocess.run
        self.module.ssh = self.real_ssh

        def missing(argv=None, **kwargs):
            raise FileNotFoundError(2, "The system cannot find the file specified")

        self.module.subprocess.run = missing
        try:
            code, _out, err = self.run_cli_main("--apply")
        finally:
            self.module.subprocess.run = real_run
            self.module.ssh = self.remote
        self.assertNotEqual(code, self.module.EXIT_OK)
        self.assertIn("could not run ssh", err)
        self.assertNotIn("Traceback", err)


class PreflightFailureAndFingerprint(HandoffHarness):
    def test_failed_preflight_refuses_and_writes_nothing(self):
        class BrokenPreflight(FakeRemote):
            def __call__(self, cmd, stdin_bytes=None):
                if "check-ignore" in cmd:
                    return 1, "", "preflight channel failed"
                return super().__call__(cmd, stdin_bytes)

        remote = BrokenPreflight(self.sandbox)
        code, _out, err = self.run_cli_main("--apply", remote=remote)
        self.assertNotEqual(code, self.module.EXIT_OK)
        self.assertIn("preflight failed", err)
        self.assertFalse(os.path.exists(self.dest_path()))
        writes = [s for _c, s in remote.calls if s is not None]
        self.assertEqual(writes, [], "the payload must not be sent after a failed preflight")

    def test_preflight_channel_error_refuses(self):
        class DeadPreflight(FakeRemote):
            def __call__(self, cmd, stdin_bytes=None):
                if "check-ignore" in cmd:
                    return 255, "", "channel closed"
                return super().__call__(cmd, stdin_bytes)

        code, _out, err = self.run_cli_main("--apply", remote=DeadPreflight(self.sandbox))
        self.assertNotEqual(code, self.module.EXIT_OK)
        self.assertIn("preflight failed", err)

    def test_wrong_fingerprint_refuses_and_leaves_the_destination_unchanged(self):
        self.write_dest("live-credential")
        remote = FakeRemote(self.sandbox, verify_override="600 rae_admin 64\n000000000000\n")
        code, out, err = self.run_cli_main("--apply", "--replace", "--confirm-replace",
                                           remote=remote)
        self.assertNotEqual(code, self.module.EXIT_OK)
        self.assertIn("FAILED VERIFICATION", err)
        self.assertNotIn("HANDOFF COMPLETE", out)

    def test_refusal_never_modifies_an_existing_destination(self):
        cases = [
            # (argv, expect the file unchanged)
            (("--apply",), True),                                  # exists, no --replace
            (("--apply", "--replace"), True),                      # no confirmation
            (("--apply",), True),                                  # repeated, still refused
        ]
        for args, unchanged in cases:
            self.write_dest("live-credential")
            remote = FakeRemote(self.sandbox)
            code, _out, _err = self.run_cli_main(*args, remote=remote)
            self.assertNotEqual(code, self.module.EXIT_OK, f"{args} must not succeed")
            if unchanged:
                self.assertEqual(self.read_dest(), "live-credential", f"{args} changed the file")

    def test_wrong_fingerprint_leaves_the_existing_destination_unchanged(self):
        self.write_dest("live-credential")
        remote = FakeRemote(self.sandbox, verify_override="600 rae_admin 64\nbadbadbadbad\n")
        code, out, err = self.run_cli_main("--apply", "--replace", "--confirm-replace",
                                           remote=remote)
        self.assertNotEqual(code, self.module.EXIT_OK)
        self.assertIn("FAILED VERIFICATION", err)
        self.assertNotIn("HANDOFF COMPLETE", out)


@unittest.skipUnless(have_tools(), "sh + coreutils are required for the remote-script tests")
class PreflightFidelity(HandoffHarness):
    """The fake preflight must execute the real command, not replay a canned reply.

    A hardcoded reply cannot observe a git worktree or a symlink, which is exactly how a
    broken symlink assertion went unnoticed on Linux. This test fails if the fake ever
    goes back to returning a fixed string.
    """

    def test_preflight_reports_a_real_git_worktree(self):
        git = shutil.which("git")
        if not git:
            self.skipTest("git is required to prove preflight fidelity")
        repo = os.path.join(self.sandbox, "worktree")
        os.makedirs(os.path.join(repo, "cfg"), exist_ok=True)
        init = subprocess.run([git, "init", "-q", repo], capture_output=True)
        if init.returncode != 0:
            self.skipTest(f"could not create a scratch git repo: {init.stderr[:80]!r}")

        remote = FakeRemote(repo)
        self.patch(self.module, remote)
        ok, pre = self.module.remote_preflight("/sbx/cfg/agent-core.token")
        self.assertTrue(ok, pre)
        self.assertIn("GITREPO", pre,
                      "the preflight must observe the real filesystem; a canned reply would "
                      "have said NOGITREPO")
        self.assertIn("GITUNIGNORED", pre)

    def test_preflight_reports_no_git_repo_outside_one(self):
        remote = FakeRemote(self.sandbox)
        self.patch(self.module, remote)
        _ok, pre = self.module.remote_preflight("/sbx/cfg/agent-core.token")
        self.assertIn("NOGITREPO", pre)

    def test_preflight_reports_existence_of_a_real_file(self):
        self.write_dest("already-here")
        remote = FakeRemote(self.sandbox)
        self.patch(self.module, remote)
        _ok, pre = self.module.remote_preflight("/sbx/cfg/agent-core.token")
        self.assertIn("EXISTS", pre)

    def test_preflight_reports_nothing_for_a_missing_file(self):
        remote = FakeRemote(self.sandbox)
        self.patch(self.module, remote)
        _ok, pre = self.module.remote_preflight("/sbx/cfg/agent-core.token")
        self.assertNotIn("EXISTS", pre)


class EnvFileErrorsAreRefusals(HandoffHarness):
    """A probe on the wrong machine must get a sentence, not a traceback."""

    def real_load(self, env_text: str):
        """Point the REAL load_token at a scratch env file."""
        self.module.load_token = self.real_load_token
        path = os.path.join(self.sandbox, "agent-core.env")
        with open(path, "w", newline="\n") as fh:
            fh.write(env_text)
        self.module.ENV_FILE = path

    def test_missing_env_file_is_a_clear_refusal(self):
        self.module.load_token = self.real_load_token
        self.module.ENV_FILE = os.path.join(self.sandbox, "does-not-exist.env")
        with self.assertRaises(SystemExit) as ctx:
            self.module.load_token()
        self.assertIn("cannot read", str(ctx.exception))

    def test_missing_keys_variable_is_a_clear_refusal(self):
        self.real_load("SOMETHING_ELSE=1\n")
        with self.assertRaises(SystemExit) as ctx:
            self.module.load_token()
        self.assertIn("AGENT_CORE_PROJECT_KEYS", str(ctx.exception))

    def test_malformed_json_is_refused_without_echoing_the_value(self):
        marker = "leak-canary-" + "a" * 20
        self.real_load('AGENT_CORE_PROJECT_KEYS={"x":"' + marker + '"\n'
                       "AGENT_CORE_PROJECT_SCOPES={}\n")
        with self.assertRaises(SystemExit) as ctx:
            self.module.load_token()
        self.assertIn("malformed JSON", str(ctx.exception))
        self.assertNotIn(marker, str(ctx.exception))

    def test_unknown_project_is_a_clear_refusal(self):
        self.real_load('AGENT_CORE_PROJECT_KEYS={"other":["decision"]}\n'
                       'AGENT_CORE_PROJECT_SCOPES={"other":["decision"]}\n')
        self.module.PROJECT = "not-onboarded"
        with self.assertRaises(SystemExit) as ctx:
            self.module.load_token()
        self.assertIn("not-onboarded", str(ctx.exception))
        self.assertIn("not in AGENT_CORE_PROJECT_KEYS", str(ctx.exception))

    def test_a_valid_env_file_still_loads(self):
        self.real_load('AGENT_CORE_PROJECT_KEYS={"rae-attendance-v2":"synthetic-value"}\n'
                       'AGENT_CORE_PROJECT_SCOPES={"rae-attendance-v2":["decision"]}\n')
        self.module.PROJECT = "rae-attendance-v2"
        token, scopes = self.module.load_token()
        self.assertEqual(token, "synthetic-value")
        self.assertEqual(scopes, ["decision"])


if __name__ == "__main__":
    unittest.main()
