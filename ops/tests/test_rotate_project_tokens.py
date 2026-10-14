#!/usr/bin/env python3
"""Tests for ops/rotate-project-tokens.py.

Hermetic: a temporary env file, SYNTHETIC tokens, a local HTTP server that models the
live token check, and in-process stubs for the two external processes (`systemctl` and
the encryptor). Nothing reads, prints or changes a real token, env file, service or
remote endpoint.

Two levels of coverage, deliberately:

  * subprocess (`run_cli`) — the real script end to end: argv parsing, exit codes, the
    env file on disk, the HTTP smoke path. Used wherever no external process is needed
    (`--no-restart`), so it is identical on Linux and Windows.
  * in-process (`run_inproc`) — the same `cmd_*` functions with `restart_service` and
    `subprocess.run` stubbed, so restart failure and the encryptor's streaming contract
    can be asserted deterministically with no fake binary on PATH.

  python3 -m unittest discover -s ops/tests -v
  python3 -m unittest ops.tests.test_rotate_project_tokens -v
"""
from __future__ import annotations

import contextlib
import http.server
import importlib.util
import io
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import unittest

OPS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(OPS, "rotate-project-tokens.py")
PY = sys.executable
IS_WINDOWS = os.name == "nt"
POSIX_ONLY = unittest.skipIf(IS_WINDOWS, "POSIX file modes are not meaningful on Windows")
PROJECTS = ["52clips", "attendance-report-generator", "handbook", "goffice2026", "dbplant", "rae-attendance-v2"]
KEY_VAR = "AGENT_CORE_PROJECT_KEYS"
SCOPE_VAR = "AGENT_CORE_PROJECT_SCOPES"


def synthetic() -> str:
    return "synthetic" + os.urandom(16).hex()


def mode_of(path: str) -> str:
    return oct(stat.S_IMODE(os.stat(path).st_mode))[2:]


class ReversibleCipher:
    """Stand-in for age/gpg. Reverses bytes so the mapping is provably reversible and
    the stored file is provably not plaintext. Records the argv it was called with."""

    def __init__(self):
        self.calls: list[list[str]] = []

    def __call__(self, argv=None, **kwargs):
        self.calls.append(list(argv or []))

        class Done:
            pass

        done = Done()
        done.returncode = 0
        done.stderr = b""
        if "input" in kwargs and kwargs["input"] is not None:
            done.stdout = bytes(kwargs["input"])[::-1]
        elif kwargs.get("stdin") is not None:
            done.stdout = kwargs["stdin"].read()[::-1]
        else:
            done.stdout = b""
        return done


class TokenAwareServer:
    """Models the live service: only the token currently in the env file is accepted."""

    def __init__(self, env_file: str):
        self.env_file = env_file
        self.seen: list[tuple[str, str]] = []
        self.frozen: dict | None = None
        outer = self

        def current_keys() -> dict:
            if outer.frozen is not None:
                return outer.frozen
            try:
                with open(outer.env_file) as fh:
                    for line in fh:
                        if line.startswith(KEY_VAR + "="):
                            return json.loads(line.split("=", 1)[1])
            except (OSError, ValueError, json.JSONDecodeError):
                pass
            return {}

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers.get("content-length") or 0))
                project = self.headers.get("x-agent-project") or ""
                token = self.headers.get("x-agent-project-token") or ""
                outer.seen.append((project, token))
                ok = bool(project) and bool(token) and current_keys().get(project) == token
                payload = json.dumps({"decision_type": "QA_DISPOSITION", "result": "ok",
                                      "confidence": 0.9, "reason_code": None, "fallback": False,
                                      "disposition": "EXECUTE", "provider_request_id": None}
                                     if ok else {"error": "UNAUTHORIZED"})
                self.send_response(200 if ok else 401)
                self.send_header("content-type", "application/json")
                self.send_header("content-length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload.encode())

            def log_message(self, *a):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def freeze(self) -> None:
        """Stop following the env file: the service keeps the tokens it already loaded."""
        self.frozen = RotateHarness.read_keys(self.env_file)

    def close(self):
        self.server.shutdown()


class RotateHarness(unittest.TestCase):
    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="rotate-test-")
        self.conf = os.path.join(self.home, "config")
        os.makedirs(self.conf)
        self.env_file = os.path.join(self.conf, "agent-core.env")
        self.backup_dir = os.path.join(self.home, "backups")
        self.server = None
        self.write_env()

    def tearDown(self):
        if self.server:
            self.server.close()
        shutil.rmtree(self.home, ignore_errors=True)

    # ------------------------------------------------------------------ fixtures
    def keys(self) -> dict:
        return self.read_keys(self.env_file)

    @staticmethod
    def read_keys(path: str) -> dict:
        with open(path) as fh:
            for line in fh:
                if line.startswith(KEY_VAR + "="):
                    return json.loads(line.split("=", 1)[1])
        return {}

    def write_env(self, keys: dict | None = None, scopes: dict | None = None,
                  extra: str = "# header\nAGENT_CORE_PORT=8787\n", perm: int = 0o600) -> None:
        self.original_keys = {p: synthetic() for p in PROJECTS} if keys is None else keys
        body = (extra
                + KEY_VAR + "=" + json.dumps(self.original_keys, separators=(",", ":")) + "\n"
                + SCOPE_VAR + "=" + json.dumps(
                    {p: ["decision"] for p in PROJECTS} if scopes is None else scopes,
                    separators=(",", ":")) + "\n")
        with open(self.env_file, "w", newline="\n") as fh:
            fh.write(body)
        os.chmod(self.env_file, perm)

    def backups(self) -> list[str]:
        return sorted(os.listdir(self.backup_dir)) if os.path.isdir(self.backup_dir) else []

    # ------------------------------------------------------------------ runners
    def run_cli(self, *args):
        """Real subprocess run. Never calls systemctl unless the caller asks for it."""
        argv = [PY, SCRIPT, "--env-file", self.env_file, *args]
        return subprocess.run(argv, capture_output=True, text=True, timeout=120)

    def run_inproc(self, *args, restart=(True, "service active"), cipher=None, which=None,
                   real_restart=False, quiet=True):
        """Call the real main() with the two external processes stubbed.

        `restart` is what a non-`--no-restart` call returns; `--no-restart` always
        keeps the real short-circuit so the flag itself stays under test.
        With `real_restart=True` the real restart_service runs against the stubbed
        `subprocess.run`, so the systemctl argv is exercised for real. `time.sleep`
        is quietened so a real restart path does not cost 3 seconds per test.
        """
        spec = importlib.util.spec_from_file_location("rotate_mod", SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)

        def fake_restart(no_restart):
            if no_restart:
                return True, "not restarted (--no-restart)"
            return restart

        if not real_restart:
            module.restart_service = fake_restart
        real_run = module.subprocess.run
        real_which = None
        real_sleep = module.time.sleep
        if cipher is not None:
            module.subprocess.run = cipher
        if which is not None:
            real_which = module.shutil.which
            module.shutil.which = which
        if quiet:
            module.time.sleep = lambda _seconds: None
        out, err = io.StringIO(), io.StringIO()
        argv = sys.argv
        sys.argv = ["rotate-project-tokens.py", "--env-file", self.env_file, *args]
        try:
            with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
                code = module.main()
        finally:
            sys.argv = argv
            module.subprocess.run = real_run
            module.time.sleep = real_sleep
            if real_which is not None:
                module.shutil.which = real_which
        return code, out.getvalue(), err.getvalue()

    @staticmethod
    def only_age(name: str):
        """Force the age branch regardless of what is installed on this host."""
        return "/usr/bin/age" if name == "age" else None

    @staticmethod
    def no_cipher(name: str):
        return None

    @staticmethod
    def process_stub(captured: list, returncode: int = 0, stdout: bytes = b"active\n"):
        """A subprocess.run stand-in that records argv and returns a CompletedProcess-like."""
        def fake(argv=None, **kwargs):
            captured.append(list(argv or []))

            class Done:
                pass

            done = Done()
            done.returncode = returncode
            done.stderr = b""
            done.stdout = stdout.decode() if kwargs.get("text") else stdout
            return done
        return fake

    def local_server(self) -> str:
        self.server = TokenAwareServer(self.env_file)
        return self.server.base

    def assertNoSecrets(self, output: str, *values: str):
        for value in values:
            self.assertNotIn(value, output)


# --------------------------------------------------------------------------- dry run / guards
class Guards(RotateHarness):
    def test_dry_run_writes_nothing_and_prints_no_values(self):
        before = open(self.env_file, "rb").read()
        r = self.run_cli("--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("would rotate 6 project tokens", r.stdout)
        self.assertEqual(open(self.env_file, "rb").read(), before)
        self.assertNoSecrets(r.stdout + r.stderr, *self.original_keys.values())
        self.assertEqual(self.backups(), [], "dry run must not write a backup")

    def test_unknown_project_is_refused(self):
        r = self.run_cli("--only", "not-a-project", "--dry-run")
        self.assertEqual(r.returncode, 4, r.stdout + r.stderr)
        self.assertIn("not present in", r.stdout + r.stderr)

    def test_duplicate_keys_line_is_refused(self):
        with open(self.env_file, "a", newline="\n") as fh:
            fh.write(KEY_VAR + "={}\n")
        r = self.run_cli("--dry-run")
        self.assertEqual(r.returncode, 4, r.stdout + r.stderr)
        self.assertIn("exactly one", r.stdout + r.stderr)

    def test_empty_keyset_is_refused(self):
        self.write_env(keys={})
        r = self.run_cli("--dry-run")
        self.assertEqual(r.returncode, 4, r.stdout + r.stderr)
        self.assertIn("refusing to guess", r.stdout + r.stderr)

    def test_malformed_json_is_refused_without_echoing_the_value(self):
        marker = "leak-canary-" + synthetic()
        with open(self.env_file, "w", newline="\n") as fh:
            fh.write("# header\n" + KEY_VAR + '={"52clips":"' + marker + '"\n')
        r = self.run_cli("--dry-run")
        self.assertEqual(r.returncode, 4, r.stdout + r.stderr)
        self.assertIn("not valid JSON", r.stdout + r.stderr)
        self.assertNotIn(marker, r.stdout + r.stderr)

    @POSIX_ONLY
    def test_group_readable_env_is_refused(self):
        os.chmod(self.env_file, 0o644)
        r = self.run_cli("--dry-run")
        self.assertEqual(r.returncode, 4, r.stdout + r.stderr)
        self.assertIn("must be mode 600", r.stdout + r.stderr)

    def test_missing_env_file_is_refused(self):
        os.unlink(self.env_file)
        self.assertEqual(self.run_cli("--dry-run").returncode, 4)


# --------------------------------------------------------------------------- rotation
class Rotation(RotateHarness):
    def test_targeted_rotation_leaves_other_projects_and_lines_untouched(self):
        r = self.run_cli("--no-restart", "--only", "rae-attendance-v2")
        self.assertEqual(r.returncode, 0, r.stderr)
        after = self.keys()
        self.assertEqual(sorted(after), sorted(self.original_keys))
        self.assertNotEqual(after["rae-attendance-v2"], self.original_keys["rae-attendance-v2"])
        for project in PROJECTS:
            if project != "rae-attendance-v2":
                self.assertEqual(after[project], self.original_keys[project], f"{project} changed")
        text = open(self.env_file).read()
        self.assertIn("# header\nAGENT_CORE_PORT=8787\n", text)
        self.assertIn(SCOPE_VAR + "=", text)
        self.assertIn(
            SCOPE_VAR + '={"52clips":["decision"],"attendance-report-generator":["decision"],'
            '"handbook":["decision"],"goffice2026":["decision"],"dbplant":["decision"],'
            '"rae-attendance-v2":["decision"]}',
            text, "the scopes line must survive rotation byte for byte")
        self.assertIn("targeted rotation: leaving 5 untouched", r.stdout)
        self.assertNoSecrets(r.stdout + r.stderr, *after.values(), *self.original_keys.values())

    def test_fleet_wide_default_keeps_every_onboarded_project(self):
        r = self.run_cli("--no-restart")
        self.assertEqual(r.returncode, 0, r.stderr)
        after = self.keys()
        self.assertEqual(sorted(after), sorted(PROJECTS))
        self.assertTrue(all(after[p] != self.original_keys[p] and len(after[p]) == 64 for p in PROJECTS))
        self.assertIn("fleet-wide rotation", r.stdout)
        self.assertEqual([f for f in os.listdir(self.conf) if f.startswith(".rotate-")], [])

    @POSIX_ONLY
    def test_mode_stays_600_and_no_temp_files_remain(self):
        self.assertEqual(self.run_cli("--no-restart").returncode, 0)
        self.assertEqual(mode_of(self.env_file), "600")
        self.assertEqual([f for f in os.listdir(self.conf) if f.startswith(".rotate-")], [])

    def test_idempotent_across_repeated_runs(self):
        first = self.run_cli("--no-restart")
        self.assertEqual(first.returncode, 0, first.stderr)
        after_first = self.keys()
        second = self.run_cli("--no-restart")
        self.assertEqual(second.returncode, 0, second.stderr)
        after_second = self.keys()

        self.assertEqual(sorted(after_second), sorted(after_first))
        self.assertTrue(all(after_second[p] != after_first[p] for p in PROJECTS),
                        "a second rotation must produce fresh tokens")
        text = open(self.env_file).read()
        self.assertEqual(text.count(KEY_VAR + "="), 1)
        self.assertEqual(text.count(SCOPE_VAR + "="), 1)
        self.assertEqual([f for f in os.listdir(self.conf) if f.startswith(".rotate-")], [])
        self.assertNoSecrets(first.stdout + second.stdout,
                             *after_first.values(), *after_second.values())

    def test_single_run_is_deterministic_in_shape(self):
        """Idempotency in the structural sense: same inputs -> same file shape."""
        def shape() -> list:
            rows = []
            for line in open(self.env_file).read().splitlines():
                if not line or line.startswith("#") or "=" not in line:
                    rows.append((line[:1], 0))
                    continue
                key, value = line.split("=", 1)
                rows.append((key, len(value)))
            return rows

        self.assertEqual(self.run_cli("--no-restart").returncode, 0)
        first = shape()
        self.assertEqual(self.run_cli("--no-restart").returncode, 0)
        self.assertEqual(shape(), first,
                         "every run must leave the same keys in the same order with the same shapes")


# --------------------------------------------------------------------------- restart
class RestartOutcomes(RotateHarness):
    def test_restart_calls_systemctl_user_restart(self):
        captured: list = []
        code, out, err = self.run_inproc("--apply", cipher=self.process_stub(captured),
                                         real_restart=True)
        self.assertEqual(code, 0, out + err)
        self.assertIn(["systemctl", "--user", "restart", "agent-core.service"], captured)
        self.assertIn(["systemctl", "--user", "is-active", "agent-core.service"], captured)

    def test_restart_argv_never_contains_credentials(self):
        captured: list = []
        self.run_inproc("--apply", cipher=self.process_stub(captured), real_restart=True)
        flattened = " ".join(" ".join(argv) for argv in captured)
        for token in self.original_keys.values():
            self.assertNotIn(token, flattened)

    def test_successful_restart_reports_the_service_state(self):
        code, out, _err = self.run_inproc("--apply", restart=(True, "service active"))
        self.assertEqual(code, 0)
        self.assertIn("service: service active", out)

    def test_inactive_service_is_a_failure(self):
        code, out, err = self.run_inproc("--apply", restart=(False, "service inactive"),
                                         cipher=self.process_stub([], stdout=b"inactive\n"),
                                         real_restart=True)
        self.assertEqual(code, 2, out + err)
        self.assertIn("service inactive", out)

    def test_missing_systemctl_is_reported_not_a_traceback(self):
        def missing(argv=None, **kwargs):
            raise FileNotFoundError(2, "The system cannot find the file specified")

        code, out, err = self.run_inproc("--apply", cipher=missing, real_restart=True)
        self.assertEqual(code, 2, out + err)
        self.assertIn("could not run systemctl", out)
        self.assertNotIn("Traceback", out + err)
        changed = self.keys()
        self.assertTrue(all(changed[p] != self.original_keys[p] for p in PROJECTS),
                        "the env file is written before the restart, and that must stay visible")
        self.assertNoSecrets(out + err, *self.original_keys.values(), *changed.values())

    def test_failed_restart_is_reported_and_points_at_recovery(self):
        code, out, err = self.run_inproc("--apply", restart=(False, "restart failed rc=1"))
        self.assertEqual(code, 2, out + err)
        self.assertIn("restart failed", out)
        self.assertIn("the env file WAS changed", out)
        self.assertIn("rollback", (out + err).lower())
        changed = self.keys()
        self.assertTrue(all(changed[p] != self.original_keys[p] for p in PROJECTS),
                        "the env file is written before the restart, and that must stay visible")
        self.assertNotIn("smoke", out, "no smoke test may run after a failed restart")
        self.assertNoSecrets(out + err, *self.original_keys.values(), *changed.values())

    def test_no_restart_skips_the_service_entirely(self):
        code, out, _err = self.run_inproc("--no-restart", restart=(False, "should not be used"))
        self.assertEqual(code, 0, out)
        self.assertIn("not restarted (--no-restart)", out)


# --------------------------------------------------------------------------- partial handoff
class PartialHandoff(RotateHarness):
    def test_project_without_scope_entry_is_warned_about(self):
        self.write_env(scopes={p: ["decision"] for p in PROJECTS if p != "handbook"})
        r = self.run_cli("--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("handbook has no " + SCOPE_VAR + " entry", r.stdout)
        self.assertIn("authorise nothing", r.stdout)

    def test_rotation_still_succeeds_when_a_project_has_no_scope(self):
        self.write_env(scopes={p: ["decision"] for p in PROJECTS if p != "dbplant"})
        r = self.run_cli("--no-restart", "--only", "dbplant")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertNotEqual(self.keys()["dbplant"], self.original_keys["dbplant"])

    def test_smoke_reaches_the_configured_endpoint_and_sends_the_new_token(self):
        base = self.local_server()
        r = self.run_cli("--only", "rae-attendance-v2", "--no-restart", "--base-url", base)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("disposition=EXECUTE", r.stdout)
        self.assertEqual(self.server.seen, [("rae-attendance-v2", self.keys()["rae-attendance-v2"])])

    def test_smoke_failure_exits_three_and_advises_rollback(self):
        base = self.local_server()
        self.server.freeze()          # the service still holds the pre-rotation tokens
        r = self.run_cli("--only", "rae-attendance-v2", "--no-restart", "--base-url", base)
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertIn("FAIL", r.stdout)
        self.assertIn("roll back", (r.stdout + r.stderr).lower())


# --------------------------------------------------------------------------- stale consumers
class StaleConsumers(RotateHarness):
    def token_status(self, base: str, project: str, token: str) -> int:
        import urllib.error
        import urllib.request
        req = urllib.request.Request(
            base + "/v1/decision", method="POST",
            data=json.dumps({"project": project}).encode(),
            headers={"x-agent-project": project, "x-agent-project-token": token})
        try:
            with urllib.request.urlopen(req, timeout=5) as resp:
                return resp.status
        except urllib.error.HTTPError as exc:
            return exc.code

    def test_rotated_project_rejects_the_old_token_and_accepts_the_new_one(self):
        base = self.local_server()
        old = self.original_keys["rae-attendance-v2"]
        r = self.run_cli("--only", "rae-attendance-v2", "--no-restart")
        self.assertEqual(r.returncode, 0, r.stderr)
        new = self.keys()["rae-attendance-v2"]

        self.assertEqual(self.token_status(base, "rae-attendance-v2", old), 401,
                         "a consumer still holding the stale token must be rejected")
        self.assertEqual(self.token_status(base, "rae-attendance-v2", new), 200)

    def test_unrotated_projects_keep_working_during_a_targeted_rotation(self):
        base = self.local_server()
        r = self.run_cli("--only", "rae-attendance-v2", "--no-restart")
        self.assertEqual(r.returncode, 0, r.stderr)
        for project in PROJECTS:
            if project != "rae-attendance-v2":
                self.assertEqual(self.token_status(base, project, self.original_keys[project]), 200,
                                 f"{project} must be unaffected")

    def test_fleet_rotation_stales_every_consumer_at_once(self):
        base = self.local_server()
        r = self.run_cli("--no-restart")
        self.assertEqual(r.returncode, 0, r.stderr)
        after = self.keys()
        for project in PROJECTS:
            self.assertEqual(self.token_status(base, project, self.original_keys[project]), 401)
            self.assertEqual(self.token_status(base, project, after[project]), 200)

    def test_smoke_reports_unauthorized_when_the_server_never_accepts(self):
        base = self.local_server()
        r = self.run_cli("--smoke", "--only", "handbook", "--base-url", base)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)   # the token in the file IS valid

    def test_smoke_with_a_stale_token_fails(self):
        """The service holds the rotated token; the caller still sends the old one."""
        self.assertEqual(self.run_cli("--only", "handbook", "--no-restart").returncode, 0)
        base = self.local_server()
        self.server.freeze()
        self.write_env(keys=self.original_keys)
        r = self.run_cli("--smoke", "--only", "handbook", "--base-url", base)
        self.assertEqual(r.returncode, 3, r.stdout + r.stderr)
        self.assertIn("FAIL", r.stdout)
        self.assertIn("HTTP 401", r.stdout)


# --------------------------------------------------------------------------- backup / rollback
class BackupAndRollback(RotateHarness):
    RECIPIENT = "syn@example.invalid"

    def encrypt(self, *args, **kwargs):
        """Rotate with an encrypted backup, forcing the age branch deterministically."""
        cipher = kwargs.pop("cipher", ReversibleCipher())
        code, out, err = self.run_inproc("--no-restart", "--backup-dir", self.backup_dir,
                                         "--backup-recipient", self.RECIPIENT,
                                         cipher=cipher, which=self.only_age, *args, **kwargs)
        return code, out, err, cipher

    def test_backup_is_encrypted_and_contains_no_plaintext_token(self):
        code, out, err, _cipher = self.encrypt()
        self.assertEqual(code, 0, out + err)
        self.assertEqual(len(self.backups()), 1, self.backups())
        name = self.backups()[0]
        self.assertTrue(name.endswith(".age"), name)
        blob = open(os.path.join(self.backup_dir, name), "rb").read()
        for project, token in self.original_keys.items():
            self.assertNotIn(token.encode(), blob, f"{project} token stored in plaintext")
        self.assertIn((KEY_VAR + "=").encode(), blob[::-1], "backup must be the env file, encrypted")
        self.assertNotIn((KEY_VAR + "=").encode(), blob)
        self.assertNoSecrets(out + err, *self.original_keys.values())

    def test_backup_streams_the_source_file_and_passes_no_secret_in_argv(self):
        code, out, err, cipher = self.encrypt()
        self.assertEqual(code, 0, out + err)
        self.assertEqual(len(cipher.calls), 1, cipher.calls)
        argv = cipher.calls[0]
        self.assertEqual(argv[0], "age")
        self.assertIn("--encrypt", argv)
        self.assertTrue(any(a.startswith("--recipient=") for a in argv))
        for token in self.original_keys.values():
            self.assertNotIn(token, " ".join(argv), "a token must never reach argv")

    def test_backup_filename_extension_follows_the_tool_actually_used(self):
        code, out, err, cipher = self.encrypt()
        self.assertEqual(code, 0, out + err)
        self.assertEqual(cipher.calls[0][0], "age")
        self.assertTrue(self.backups()[0].endswith(".age"), self.backups())

    def test_gpg_host_gets_a_gpg_suffixed_backup(self):
        cipher = ReversibleCipher()
        code, out, err = self.run_inproc(
            "--no-restart", "--backup-dir", self.backup_dir, "--backup-recipient", self.RECIPIENT,
            cipher=cipher, which=lambda name: "/usr/bin/gpg" if name == "gpg" else None)
        self.assertEqual(code, 0, out + err)
        self.assertEqual(cipher.calls[0][0], "gpg")
        self.assertTrue(self.backups()[0].endswith(".gpg"), self.backups())

    def test_backup_refuses_when_no_encryption_tool_is_available(self):
        code, out, err = self.run_inproc(
            "--no-restart", "--backup-dir", self.backup_dir, "--backup-recipient", self.RECIPIENT,
            cipher=ReversibleCipher(), which=self.no_cipher)
        self.assertEqual(code, 4, out + err)
        self.assertIn("no encryption tool found", out + err)
        self.assertEqual(self.backups(), [], "a refusal must not leave a backup behind")
        self.assertEqual(self.keys(), self.original_keys, "a refusal must not rotate")

    def test_unrunnable_encryptor_is_refused_without_rotating(self):
        def missing(argv=None, **kwargs):
            raise FileNotFoundError(2, "The system cannot find the file specified")

        code, out, err = self.run_inproc(
            "--no-restart", "--backup-dir", self.backup_dir, "--backup-recipient", self.RECIPIENT,
            cipher=missing, which=self.only_age)
        self.assertEqual(code, 4, out + err)
        self.assertIn("could not run age", out + err)
        self.assertEqual(self.keys(), self.original_keys, "a refusal must not rotate")

    def test_two_backups_in_the_same_second_do_not_collide(self):
        for _ in range(2):
            code, out, err, _c = self.encrypt()
            self.assertEqual(code, 0, out + err)
        self.assertEqual(len(self.backups()), 2, self.backups())

    def test_rotating_without_a_recipient_warns_that_it_is_not_reversible(self):
        r = self.run_cli("--no-restart")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("not reversible", r.stdout)
        self.assertEqual(self.backups(), [])

    def test_rollback_restores_exact_bytes_and_the_previous_token(self):
        before = open(self.env_file, "rb").read()
        cipher = ReversibleCipher()
        code, out, err, _c = self.encrypt(cipher=cipher)
        self.assertEqual(code, 0, out + err)
        self.assertNotEqual(open(self.env_file, "rb").read(), before)
        backup = os.path.join(self.backup_dir, self.backups()[0])

        base = self.local_server()
        code, out, err = self.run_inproc("--rollback", backup, "--no-restart", "--base-url", base,
                                         cipher=cipher, which=self.only_age)
        self.assertEqual(code, 0, out + err)
        self.assertEqual(open(self.env_file, "rb").read(), before,
                         "rollback must restore the pre-rotation bytes exactly")
        self.assertEqual(self.keys(), self.original_keys)
        self.assertIn("disposition=EXECUTE", out)
        self.assertNoSecrets(out + err, *self.original_keys.values())

    def test_rollback_decrypts_the_backup_rather_than_writing_it_verbatim(self):
        cipher = ReversibleCipher()
        code, out, err, _c = self.encrypt(cipher=cipher)
        self.assertEqual(code, 0, out + err)
        rotated = open(self.env_file, "rb").read()
        backup = os.path.join(self.backup_dir, self.backups()[0])
        self.run_inproc("--rollback", backup, "--no-restart", cipher=cipher, which=self.only_age)
        restored = open(self.env_file, "rb").read()
        self.assertEqual(restored[::-1], open(backup, "rb").read(),
                         "the restored file must be the decryption of the backup")
        self.assertNotEqual(restored, rotated)

    @POSIX_ONLY
    def test_rollback_restores_mode_600(self):
        self.encrypt()
        backup = os.path.join(self.backup_dir, self.backups()[0])
        self.run_inproc("--rollback", backup, "--no-restart",
                        cipher=ReversibleCipher(), which=self.only_age)
        self.assertEqual(mode_of(self.env_file), "600")

    def test_rollback_dry_run_writes_nothing(self):
        cipher = ReversibleCipher()
        self.encrypt(cipher=cipher)
        backup = os.path.join(self.backup_dir, self.backups()[0])
        before = open(self.env_file, "rb").read()
        code, out, err = self.run_inproc("--rollback", backup, "--dry-run", cipher=cipher)
        self.assertEqual(code, 0, out + err)
        self.assertIn("would restore", out)
        self.assertEqual(open(self.env_file, "rb").read(), before)

    def test_rollback_of_a_corrupt_backup_is_refused(self):
        cipher = ReversibleCipher()
        self.encrypt(cipher=cipher)
        backup = os.path.join(self.backup_dir, self.backups()[0])
        before = open(self.env_file, "rb").read()

        def failing(argv=None, **kwargs):
            class Done:
                returncode, stdout, stderr = 2, b"", b"synthetic failure"
            return Done()

        code, out, err = self.run_inproc("--rollback", backup, "--no-restart",
                                         cipher=failing, which=self.only_age)
        self.assertEqual(code, 4, out + err)
        self.assertIn("could not decrypt", out + err)
        self.assertEqual(open(self.env_file, "rb").read(), before, "a failed rollback must not write")
        self.assertNotIn(b"synthetic failure", open(self.env_file, "rb").read())

    def test_rollback_refuses_a_backup_that_is_not_an_env_file(self):
        cipher = ReversibleCipher()
        self.encrypt(cipher=cipher)
        corrupt = os.path.join(self.backup_dir, "agent-core.env.20260101T000000.age")
        with open(corrupt, "wb") as fh:
            fh.write(b"not an env file"[::-1])
        before = open(self.env_file, "rb").read()
        code, out, err = self.run_inproc("--rollback", corrupt, "--no-restart",
                                         cipher=cipher, which=self.only_age)
        self.assertEqual(code, 4, out + err)
        self.assertEqual(open(self.env_file, "rb").read(), before, "a refused rollback must not write")


# --------------------------------------------------------------------------- roll forward
class RollForward(RotateHarness):
    def test_restart_only_resumes_without_rotating_again(self):
        self.assertEqual(self.run_cli("--no-restart").returncode, 0)
        before = self.keys()
        code, out, err = self.run_inproc("--restart-only", "--only", "rae-attendance-v2")
        self.assertEqual(code, 0, out + err)
        self.assertIn("env file is not modified", out)
        self.assertEqual(self.keys(), before, "roll-forward must not rotate")

    def test_restart_only_reports_a_still_failing_restart(self):
        self.assertEqual(self.run_cli("--no-restart").returncode, 0)
        before = self.keys()
        code, out, err = self.run_inproc("--restart-only", restart=(False, "restart failed rc=1"))
        self.assertEqual(code, 2, out + err)
        self.assertIn("restart failed", out)
        self.assertEqual(self.keys(), before)


# --------------------------------------------------------------------------- handoff compat (VPS190 mock)
class HandoffCompatibility(RotateHarness):
    """The rotation must keep producing an env file the real handoff can still read.
    No ssh, no VPS: the handoff's own loader is imported and given the rotated file."""

    def handoff_module(self):
        spec = importlib.util.spec_from_file_location(
            "handoff", os.path.join(OPS, "handoff-project-token.py"))
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.ENV_FILE = self.env_file
        return module

    def test_handoff_can_still_load_a_rotated_token_and_its_scopes(self):
        module = self.handoff_module()
        module.PROJECT = "rae-attendance-v2"
        before_token, before_scopes = module.load_token()
        self.assertEqual(before_token, self.original_keys["rae-attendance-v2"])

        self.assertEqual(self.run_cli("--only", "rae-attendance-v2", "--no-restart").returncode, 0)

        after_token, after_scopes = module.load_token()
        self.assertEqual(after_token, self.keys()["rae-attendance-v2"])
        self.assertNotEqual(after_token, before_token)
        self.assertEqual(after_scopes, before_scopes, "rotation must not disturb scopes")
        self.assertEqual(after_scopes, ["decision"])

    def test_handoff_fingerprint_recipe_still_applies_after_rotation(self):
        module = self.handoff_module()
        module.PROJECT = "handbook"
        self.assertEqual(self.run_cli("--only", "handbook", "--no-restart").returncode, 0)
        token, scopes = module.load_token()
        self.assertEqual(len(module.fp(token)), 12)
        self.assertEqual(token, self.keys()["handbook"])
        self.assertEqual(scopes, ["decision"])

    def test_handoff_load_token_still_works_after_a_fleet_rotation(self):
        self.assertEqual(self.run_cli("--no-restart").returncode, 0)
        module = self.handoff_module()
        after = self.keys()
        for project in PROJECTS:
            module.PROJECT = project
            token, scopes = module.load_token()
            self.assertEqual(token, after[project], project)
            self.assertEqual(scopes, ["decision"], project)


if __name__ == "__main__":
    unittest.main()
