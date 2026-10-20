#!/usr/bin/env python3
"""Tests for the ops scripts: token-safe handling, permissions, atomic writes, exit codes.

Every test runs with a temporary HOME, SYNTHETIC credentials, a fake `systemctl`/`curl` on
PATH and (where needed) a local fake Cloudflare API. Nothing reads, prints or modifies a real
token, env file, service or Cloudflare object.

  python3 -m unittest discover -s ops/tests -v
"""
import hashlib
import http.server
import importlib.util
import json
import os
import secrets
import shutil
import stat
import subprocess
import sys
import tempfile
import threading
import unittest

OPS = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable


def synthetic_token() -> str:
    return "synthetic" + secrets.token_hex(28)


def mode(path: str) -> str:
    return oct(stat.S_IMODE(os.stat(path).st_mode))[2:]


class Sandbox(unittest.TestCase):
    """Temporary HOME with ~/.config/agent-core and a bin/ dir of fakes first on PATH."""

    def setUp(self):
        self.home = tempfile.mkdtemp(prefix="ops-test-")
        self.conf = os.path.join(self.home, ".config", "agent-core")
        os.makedirs(self.conf, mode=0o700)
        self.bin = os.path.join(self.home, "bin")
        os.makedirs(self.bin)
        self.calls = os.path.join(self.home, "calls.log")
        for name in ("systemctl", "curl"):
            self.fake(name, f'echo "{name} $*" >> "{self.calls}"\n'
                            + ('[ "$2" = "is-active" ] && echo active\ntrue\n' if name == "systemctl" else
                               'echo \'{"status":"ok","service":"agent-core","auth_required":true,"provider_configured":true,"jev_model":"x"}\'\n'))

    def tearDown(self):
        shutil.rmtree(self.home, ignore_errors=True)

    def fake(self, name: str, body: str):
        path = os.path.join(self.bin, name)
        with open(path, "w") as fh:
            fh.write("#!/usr/bin/env bash\n" + body)
        os.chmod(path, 0o755)

    def env(self, **extra):
        e = {"HOME": self.home, "PATH": f"{self.bin}:{os.environ['PATH']}", "LANG": "C.UTF-8"}
        e.update(extra)
        return e

    def run_ops(self, script, *args, **env):
        cmd = ["bash", os.path.join(OPS, script)] if script.endswith(".sh") else [PY, os.path.join(OPS, script)]
        return subprocess.run([*cmd, *args], env=self.env(**env), capture_output=True, text=True, timeout=60)

    def write(self, path, text, perm=0o600):
        with open(path, "w") as fh:
            fh.write(text)
        os.chmod(path, perm)

    def assertNoSecrets(self, output: str, *values: str):
        for v in values:
            self.assertNotIn(v, output)


class RotateProjectTokens(Sandbox):
    PROJECTS = ["52clips", "attendance-report-generator", "handbook", "goffice2026", "dbplant", "rae-attendance-v2"]

    def make_env(self):
        self.keys = {p: synthetic_token() for p in self.PROJECTS}
        self.env_file = os.path.join(self.conf, "agent-core.env")
        self.write(self.env_file, "# header\nAGENT_CORE_PORT=8787\n"
                   f"AGENT_CORE_PROJECT_KEYS={json.dumps(self.keys, separators=(',', ':'))}\n"
                   'AGENT_CORE_PROJECT_SCOPES={"rae-attendance-v2":["decision"]}\n')

    def test_dry_run_writes_nothing_and_prints_no_values(self):
        self.make_env()
        before = open(self.env_file, "rb").read()
        r = self.run_ops("rotate-project-tokens.py", "--dry-run")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("would rotate 6 project tokens", r.stdout)
        self.assertEqual(open(self.env_file, "rb").read(), before)
        self.assertNoSecrets(r.stdout + r.stderr, *self.keys.values())
        self.assertFalse(os.path.exists(self.calls), "dry run must not touch systemctl")

    def test_rotation_keeps_every_onboarded_project_atomically(self):
        self.make_env()
        r = self.run_ops("rotate-project-tokens.py", "--no-restart")
        self.assertEqual(r.returncode, 0, r.stderr)
        text = open(self.env_file).read()
        new = json.loads(next(l.split("=", 1)[1] for l in text.splitlines() if l.startswith("AGENT_CORE_PROJECT_KEYS=")))
        self.assertEqual(sorted(new), sorted(self.PROJECTS))           # rae-attendance-v2 is not dropped
        self.assertTrue(all(new[p] != self.keys[p] and len(new[p]) == 64 for p in self.PROJECTS))
        self.assertIn("# header\nAGENT_CORE_PORT=8787\n", text)
        self.assertIn('AGENT_CORE_PROJECT_SCOPES={"rae-attendance-v2":["decision"]}', text)
        self.assertEqual(mode(self.env_file), "600")
        self.assertEqual([f for f in os.listdir(self.conf) if ".tmp-" in f], [])
        self.assertNoSecrets(r.stdout + r.stderr, *self.keys.values(), *new.values())

    def test_restart_uses_user_systemctl(self):
        self.make_env()
        r = self.run_ops("rotate-project-tokens.py")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("systemctl --user restart agent-core.service", open(self.calls).read())

    def test_refuses_ambiguous_or_missing_env(self):
        self.assertNotEqual(self.run_ops("rotate-project-tokens.py", "--dry-run").returncode, 0)
        self.write(os.path.join(self.conf, "agent-core.env"), "AGENT_CORE_PROJECT_KEYS={}\nAGENT_CORE_PROJECT_KEYS={}\n")
        r = self.run_ops("rotate-project-tokens.py", "--dry-run")
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("exactly one", r.stdout + r.stderr)


class InjectOpenRouterKey(Sandbox):
    def setUp(self):
        super().setUp()
        self.key = "sk-synthetic-" + secrets.token_hex(16)
        self.src = os.path.join(self.home, "src.env")
        self.dest = os.path.join(self.conf, "agent-core.env")
        self.argv_log = os.path.join(self.home, "python-argv.log")
        real_python = shutil.which("python3")
        self.fake("python3", f'printf "%s\\n" "$@" >> "{self.argv_log}"\nexec "{real_python}" "$@"\n')

    def test_key_never_in_argv_and_written_0600(self):
        self.write(self.src, f'OPENROUTER_API_KEY="{self.key}"\n')
        self.write(self.dest, "A=1\nOPENROUTER_API_KEY=\n")
        r = self.run_ops("inject-openrouter-key.sh", INJECT_SRC=self.src, INJECT_DEST=self.dest, INJECT_NO_RESTART="1")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn(f"OPENROUTER_API_KEY={self.key}\n", open(self.dest).read())
        self.assertEqual(mode(self.dest), "600")
        self.assertNotIn(self.key, open(self.argv_log).read())
        self.assertNoSecrets(r.stdout + r.stderr, self.key)

    def test_missing_key_fails(self):
        self.write(self.src, "OTHER=1\n")
        self.write(self.dest, "A=1\n")
        r = self.run_ops("inject-openrouter-key.sh", INJECT_SRC=self.src, INJECT_DEST=self.dest, INJECT_NO_RESTART="1")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(open(self.dest).read(), "A=1\n")


class ActivateUserSpace(Sandbox):
    def test_first_run_creates_private_env_and_rerun_keeps_it(self):
        os.rmdir(self.conf)
        r = self.run_ops("activate-user-space.sh")
        self.assertEqual(r.returncode, 0, r.stderr)
        env_file = os.path.join(self.conf, "agent-core.env")
        self.assertEqual(mode(env_file), "600")
        self.assertEqual(mode(self.conf), "700")
        unit = os.path.join(self.home, ".config", "systemd", "user", "agent-core.service")
        self.assertEqual(mode(unit), "600")   # umask 077 applies to everything the script creates
        keys = json.loads(next(l.split("=", 1)[1] for l in open(env_file) if l.startswith("AGENT_CORE_PROJECT_KEYS=")))
        self.assertNoSecrets(r.stdout + r.stderr, *keys.values())
        before = open(env_file).read()
        r2 = self.run_ops("activate-user-space.sh")
        self.assertEqual(r2.returncode, 0, r2.stderr)
        self.assertIn("kept existing", r2.stdout)
        self.assertEqual(open(env_file).read(), before)


class CfAccessBundle(Sandbox):
    def setUp(self):
        super().setUp()
        self.bundle = os.path.join(self.conf, "cf-access.env")
        self.cid = "synthetic" + secrets.token_hex(8) + ".access"
        self.csec = "synthetic" + secrets.token_hex(16)

    def test_validate_verdicts_and_exit_codes(self):
        cases = [
            (f"CF_ACCESS_CLIENT_ID={self.cid}\nCF_ACCESS_CLIENT_SECRET={self.csec}\n", 0o600, 0),
            (f"CF_ACCESS_CLIENT_ID={self.cid}\nCF_ACCESS_CLIENT_SECRET=\n", 0o600, 1),
            (f"CF_ACCESS_CLIENT_ID={self.cid}\nCF_ACCESS_CLIENT_ID={self.cid}\n", 0o600, 1),
            (f"CF_ACCESS_CLIENT_ID={self.cid}\r\nCF_ACCESS_CLIENT_SECRET={self.csec}\r\n", 0o600, 1),
            (f"CF_ACCESS_CLIENT_ID={self.cid}\nCF_ACCESS_CLIENT_SECRET={self.csec}\n", 0o644, 1),
        ]
        for body, perm, expected in cases:
            self.write(self.bundle, body, perm)
            r = self.run_ops("validate-cf-access-bundle.py")
            self.assertEqual(r.returncode, expected, (body.encode(), oct(perm), r.stdout))
            self.assertNoSecrets(r.stdout + r.stderr, self.cid, self.csec)

    def test_normalise_is_atomic_and_value_preserving(self):
        self.write(self.bundle, f"CF-Access-Client-Id={self.cid}\n\nCF-Access-Client-Secret={self.csec}\n")
        r = self.run_ops("normalise-cf-access-bundle.py")
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(open(self.bundle).read(), f"CF_ACCESS_CLIENT_ID={self.cid}\nCF_ACCESS_CLIENT_SECRET={self.csec}\n")
        self.assertEqual(mode(self.bundle), "600")
        self.assertEqual([f for f in os.listdir(self.conf) if ".tmp-" in f], [])
        self.assertNoSecrets(r.stdout + r.stderr, self.cid, self.csec)
        self.assertEqual(self.run_ops("validate-cf-access-bundle.py").returncode, 0)

    def test_normalise_refuses_duplicate_aliases_without_writing(self):
        body = f"CF-Access-Client-Id={self.cid}\nCF_ACCESS_CLIENT_ID=other\nCF_ACCESS_CLIENT_SECRET={self.csec}\n"
        self.write(self.bundle, body)
        r = self.run_ops("normalise-cf-access-bundle.py")
        self.assertNotEqual(r.returncode, 0)
        self.assertEqual(open(self.bundle).read(), body)


class FakeCloudflare:
    """Minimal fake of the Cloudflare v4 API: {path: (status, result)}."""

    def __init__(self, routes):
        self.routes = routes
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self):
                status, result = outer.routes.get(self.path, (404, None))
                body = json.dumps({"success": status == 200, "result": result, "errors": [] if status == 200 else [{"code": status}]})
                self.send_response(status)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(body.encode())

            def do_POST(self):
                self.do_GET()

            def log_message(self, *a):
                pass

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()


ACC, APP, POL, OTHER = "synthetic-account", "app-machine", "pol-1", "app-other"


class CloudflareScripts(Sandbox):
    def setUp(self):
        super().setUp()
        self.write(os.path.join(self.conf, "cloudflare.token"), "synthetic-cf-api-token\n")
        self.policy = {"id": POL, "name": "machine", "decision": "non_identity", "precedence": 1,
                       "include": [{"any_valid_service_token": {}}], "exclude": [], "require": [], "reusable": False}
        self.routes = {
            f"/accounts/{ACC}/access/apps": (200, [{"id": APP, "name": "machine api"}, {"id": OTHER, "name": None}]),
            f"/accounts/{ACC}/access/apps/{APP}/policies": (200, [self.policy]),
            f"/accounts/{ACC}/access/apps/{OTHER}/policies": (200, []),
            f"/accounts/{ACC}/access/service_tokens": (200, [{"id": "t1", "name": "qa", "client_secret": "synthetic-should-strip"}]),
        }
        self.cf = FakeCloudflare(self.routes)
        self.backups = os.path.join(self.home, "backups")
        self.base_env = dict(CF_API_BASE=self.cf.base, CF_ACCOUNT_ID=ACC, CF_MACHINE_APP_ID=APP,
                             CF_MACHINE_POLICY_ID=POL, CF_ACCESS_BACKUP_ROOT=self.backups)

    def tearDown(self):
        self.cf.close()
        super().tearDown()

    def snapshot(self):
        r = self.run_ops("cf-access-snapshot.py", **self.base_env)
        snap = os.path.join(self.backups, os.listdir(self.backups)[0])
        return r, snap

    def test_scripts_refuse_without_identifiers(self):
        for script in ("cf-access-snapshot.py", "j2c5-access-probe.py", "j2c7-preflight.py", "j2c8-policy-verify.py"):
            r = self.run_ops(script, CF_API_BASE=self.cf.base)
            self.assertNotEqual(r.returncode, 0, script)
            self.assertIn("REFUSING: set CF_", r.stdout + r.stderr, script)

    def test_snapshot_complete_strips_secrets(self):
        r, snap = self.snapshot()
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        manifest = json.load(open(os.path.join(snap, "MANIFEST.json")))
        self.assertTrue(manifest["complete"])
        self.assertNotIn("synthetic-should-strip", open(os.path.join(snap, "service-tokens.json")).read())
        self.assertEqual(mode(snap), "700")
        check = subprocess.run(["sha256sum", "-c", "SHA256SUMS"], cwd=snap, capture_output=True)
        self.assertEqual(check.returncode, 0)

    def test_snapshot_incomplete_exits_nonzero(self):
        self.routes[f"/accounts/{ACC}/access/service_tokens"] = (403, None)
        r, snap = self.snapshot()
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("INCOMPLETE SNAPSHOT", r.stdout + r.stderr)
        self.assertFalse(json.load(open(os.path.join(snap, "MANIFEST.json")))["complete"])

    def test_j2c7_apply_ready_requires_intact_snapshot(self):
        _, snap = self.snapshot()
        env = dict(self.base_env, CF_ACCESS_SNAPSHOT_DIR=snap, TOKEN_UUID="12345678-1234-1234-1234-123456789abc")
        r = self.run_ops("j2c7-preflight.py", **env)
        self.assertIn("APPLY READY: True", r.stdout, r.stdout + r.stderr)
        with open(os.path.join(snap, "apps.json"), "a") as fh:
            fh.write(" ")                      # tamper: hash no longer matches SHA256SUMS
        r = self.run_ops("j2c7-preflight.py", **env)
        self.assertIn("SNAPSHOT INTACT: False", r.stdout)
        self.assertIn("APPLY READY: False", r.stdout)

    def test_j2c7_new_app_is_drift_not_crash(self):
        _, snap = self.snapshot()
        self.routes[f"/accounts/{ACC}/access/apps"][1].append({"id": "app-new", "name": "new"})
        self.routes["/accounts/" + ACC + "/access/apps/app-new/policies"] = (200, [])
        env = dict(self.base_env, CF_ACCESS_SNAPSHOT_DIR=snap, TOKEN_UUID="12345678-1234-1234-1234-123456789abc")
        r = self.run_ops("j2c7-preflight.py", **env)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn("NOT IN SNAPSHOT", r.stdout)
        self.assertIn("APPLY READY: False", r.stdout)

    def test_j2c8_verdicts(self):
        _, snap = self.snapshot()
        env = dict(self.base_env, CF_ACCESS_SNAPSHOT_DIR=snap)
        pinned = dict(self.policy, include=[{"service_token": {"token_id": "t1"}}])
        self.routes[f"/accounts/{ACC}/access/apps/{APP}/policies"] = (200, [pinned])
        r = self.run_ops("j2c8-policy-verify.py", **env)
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertIn("SHAPE_A INVARIANTS: PASS", r.stdout)
        self.routes[f"/accounts/{ACC}/access/apps/{APP}/policies"] = (200, [dict(pinned, include=[])])
        r = self.run_ops("j2c8-policy-verify.py", **env)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("SHAPE_A INVARIANTS: FAIL", r.stdout)
        self.routes[f"/accounts/{ACC}/access/apps/{APP}/policies"] = (200, [])
        r = self.run_ops("j2c8-policy-verify.py", **env)
        self.assertNotEqual(r.returncode, 0)
        self.assertIn("no longer exists", r.stdout + r.stderr)

    def test_j2c5_compat_unknown_when_inventory_unavailable(self):
        self.routes[f"/accounts/{ACC}/access/service_tokens"] = (403, None)
        r = self.run_ops("j2c5-access-probe.py", **self.base_env, AGENT_CORE_EDGE_BASE=self.cf.base)
        self.assertIn("COMPAT: UNKNOWN", r.stdout, r.stdout + r.stderr)
        self.assertNotIn("NOBODY", r.stdout)


class HandoffGuards(Sandbox):
    def test_existing_guard_suite(self):
        r = subprocess.run([PY, os.path.join(OPS, "test_handoff_guards.py")], capture_output=True, text=True, timeout=60)
        self.assertEqual(r.returncode, 0, r.stdout[-800:])
        self.assertIn("16/16 checks PASS", r.stdout)

    def test_refuses_without_operator_supplied_fingerprint(self):
        spec = importlib.util.spec_from_file_location("handoff", os.path.join(OPS, "handoff-project-token.py"))
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)
        mod.EXPECT_FP = ""
        mod.load_token = lambda: ("synthetic" * 7, ["decision"])
        mod.ssh = lambda *a, **k: self.fail("must refuse before any ssh")
        argv, sys.argv = sys.argv, ["handoff", "--dest", "/home/rae_admin/.config/rae-attendance-v2-qa/agent-core.token"]
        try:
            with self.assertRaises(SystemExit) as ctx:
                mod.main()
        finally:
            sys.argv = argv
        self.assertIn("HANDOFF_EXPECT_FP", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
