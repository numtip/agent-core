#!/usr/bin/env python3
"""Rotate Agent Core project tokens in the protected env file.
Prints only counts and SHA-256 fingerprints — never token values.

Every project already present in AGENT_CORE_PROJECT_KEYS is rotated (plus the
baseline PROJECTS list), so no onboarded project is ever dropped. `--only`
narrows the rotation to a named subset; the default stays fleet-wide so existing
runbooks and `ops/tests/test_ops_scripts.py` keep their contract.

Usage:
  python3 ops/rotate-project-tokens.py --dry-run
  python3 ops/rotate-project-tokens.py --only rae-attendance-v2 --backup-recipient <key> --apply
  python3 ops/rotate-project-tokens.py --restart-only          # finish an interrupted run
  python3 ops/rotate-project-tokens.py --rollback <backup>     # restore previous tokens

Safety properties (each covered by ops/tests/test_rotate_project_tokens.py):
  * a malformed AGENT_CORE_PROJECT_KEYS is refused without echoing the value
  * the env file must already be mode 600 and stays 600 after the replace
  * the replace is atomic; the payload never passes through a plaintext file
  * backups are always encrypted (age or gpg); no plaintext backup is ever written
  * a failed restart is reported as a failure, not as success
  * every rotated project can be smoke-tested through the real HTTP contract
  * nothing but sha256 prefixes and lengths is ever printed
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

def _home() -> str:
    """Honour HOME explicitly: `~` does not expand to HOME on every platform, and
    the ops scripts are run from test harnesses that relocate HOME."""
    return os.environ.get("HOME") or os.path.expanduser("~")


def default_env_file() -> str:
    return os.path.join(_home(), ".config", "agent-core", "agent-core.env")


def default_backup_dir() -> str:
    return os.path.join(_home(), ".config", "agent-core", "backups")


# Kept for callers that referenced the module constant; `main()` resolves it at call
# time via default_env_file() so a relocated HOME takes effect.
ENV_FILE = default_env_file()
DEFAULT_BACKUP_DIR = default_backup_dir()
PROJECTS = ["52clips", "attendance-report-generator", "handbook", "goffice2026", "dbplant"]
KEY_VAR = "AGENT_CORE_PROJECT_KEYS"
SCOPE_VAR = "AGENT_CORE_PROJECT_SCOPES"
SERVICE = "agent-core.service"

EXIT_OK, EXIT_RESTART, EXIT_SMOKE, EXIT_REFUSED, EXIT_EDGE = 0, 2, 3, 4, 5

# Smoke outcome kinds.
SMOKE_OK, SMOKE_TOKEN, SMOKE_EDGE, SMOKE_BAD = "ok", "token", "edge", "bad"


class Refuse(Exception):
    """Something must stop the operation before any write."""


def fp(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()[:8]


# --------------------------------------------------------------------------- env file
def read_env(path: str) -> list[str]:
    if not os.path.exists(path):
        raise Refuse(f"FAIL: {path} not found")
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read().splitlines()


def kv(lines: list[str]) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in lines:
        s = line.strip()
        if s and not s.startswith("#") and "=" in s:
            k, v = s.split("=", 1)
            out[k] = v
    return out


def json_var(lines: list[str], name: str, required: bool = True) -> dict:
    """Parse a JSON object variable. A refusal must never echo the raw value."""
    values = kv(lines)
    if name not in values:
        if required:
            raise Refuse(f"FAIL: {name} not found")
        return {}
    try:
        parsed = json.loads(values[name])
    except json.JSONDecodeError as exc:
        raise Refuse(f"FAIL: {name} is not valid JSON ({exc.__class__.__name__} at column {exc.colno})") from None
    if not isinstance(parsed, dict):
        raise Refuse(f"FAIL: {name} must be a JSON object")
    return parsed


def assert_single_keys_line(lines: list[str]) -> None:
    found = [l for l in lines if l.startswith(KEY_VAR + "=")]
    if len(found) != 1:
        raise Refuse(f"FAIL: expected exactly one {KEY_VAR} line, found {len(found)}")


# --------------------------------------------------------------------------- atomic write
def mode_of(path: str) -> str:
    if os.name == "nt":
        return "n/a"
    return oct(os.stat(path).st_mode)[-3:]


def check_mode_600(path: str) -> None:
    """Refuse to run against a group- or world-readable source."""
    if os.name == "nt":
        return
    got = mode_of(path)
    if got != "600":
        raise Refuse(f"FAIL: {path} must be mode 600 before rotating (is {got})")


def atomic_write(path: str, text: str, mode: int = 0o600) -> None:
    """Atomic replace with mode enforcement. Text is UTF-8 with LF endings so a
    later byte-exact rollback is possible regardless of platform."""
    directory = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(prefix=".rotate-", dir=directory)
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(text)
            fh.flush()
            os.fsync(fh.fileno())
        if os.name != "nt":
            os.chmod(tmp, mode)
        os.replace(tmp, path)
        if os.name != "nt":
            os.chmod(path, mode)
            dirfd = os.open(directory, os.O_RDONLY)
            try:
                os.fsync(dirfd)
            finally:
                os.close(dirfd)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    got = mode_of(path)
    if os.name != "nt" and got != "600":
        raise Refuse(f"FAIL: post-write mode check failed ({got}, expected 600)")


# --------------------------------------------------------------------------- encrypted backup
def cipher_argv(recipients: list[str]) -> tuple[str, list[str]]:
    """Pick an encryption tool. There is deliberately no plaintext fallback."""
    if shutil.which("age"):
        return "age", ["age", "--encrypt", *[f"--recipient={r}" for r in recipients]]
    if shutil.which("gpg"):
        return "gpg", ["gpg", "--batch", "--yes", "--no-tty", "--encrypt", "--armor",
                       *[x for r in recipients for x in ("--recipient", r)]]
    raise Refuse("FAIL: no encryption tool found (install age or gpg); "
                 "refusing to write a plaintext backup")


def backup_encrypted(src: str, backup_dir: str, recipients: list[str]) -> str:
    """Stream the env file through the encryptor into a new file.

    The plaintext is only ever the source file itself: it goes from the open
    handle into the encryptor's stdin, and only ciphertext reaches the disk.
    The filename extension follows the tool that is actually used, so a rollback
    picks the same tool back up.
    """
    name, argv = cipher_argv(recipients)

    os.makedirs(backup_dir, exist_ok=True)
    if os.name != "nt":
        os.chmod(backup_dir, 0o700)

    stamp = time.strftime("%Y%m%dT%H%M%S")
    ext = ".age" if name == "age" else ".gpg"
    stem = os.path.join(backup_dir, f"agent-core.env.{stamp}")
    dest, suffix = stem + ext, 1
    while os.path.exists(dest):                      # two runs in one second must not collide
        suffix += 1
        if suffix > 100:
            raise Refuse(f"FAIL: too many backups for {stamp}; clean {backup_dir} first")
        dest = f"{stem}-{suffix}{ext}"

    try:
        with open(src, "rb") as fh:
            proc = subprocess.run(argv, stdin=fh, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        raise Refuse(f"FAIL: could not run {name} ({exc.__class__.__name__}); "
                     "refusing to continue without a backup") from None
    if proc.returncode != 0:
        raise Refuse(f"FAIL: backup encryption failed with {name} "
                     f"(rc={proc.returncode}, stderr {len(proc.stderr)} bytes withheld)")
    if not proc.stdout:
        raise Refuse(f"FAIL: {name} produced an empty backup")

    fd = os.open(dest, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as fh:
        fh.write(proc.stdout)
        fh.flush()
        os.fsync(fh.fileno())
    return dest


def decrypt_backup(backup: str) -> str:
    with open(backup, "rb") as fh:
        blob = fh.read()
    name = "age" if backup.endswith(".age") else "gpg"
    if not shutil.which(name):
        raise Refuse(f"FAIL: {name} is required to restore {backup}")
    argv = ["age", "--decrypt"] if name == "age" else ["gpg", "--batch", "--yes", "--decrypt"]
    try:
        proc = subprocess.run(argv, input=blob, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        raise Refuse(f"FAIL: could not run {name} to decrypt {os.path.basename(backup)} "
                     f"({exc.__class__.__name__})") from None
    if proc.returncode != 0:
        raise Refuse(f"FAIL: could not decrypt {os.path.basename(backup)} "
                     f"(rc={proc.returncode}, stderr {len(proc.stderr)} bytes withheld)")
    return proc.stdout.decode("utf-8")


# --------------------------------------------------------------------------- service
def restart_service(no_restart: bool) -> tuple[bool, str]:
    if no_restart:
        return True, "not restarted (--no-restart)"
    # A missing or unrunnable systemctl must be a reported failure, never a traceback
    # in the middle of a rotation: the env file has already been replaced by then.
    try:
        proc = subprocess.run(["systemctl", "--user", "restart", SERVICE],
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except OSError as exc:
        return False, f"could not run systemctl ({exc.__class__.__name__})"
    if proc.returncode != 0:
        return False, f"restart failed rc={proc.returncode}"
    time.sleep(3)
    try:
        active = subprocess.run(["systemctl", "--user", "is-active", SERVICE],
                                capture_output=True, text=True)
    except OSError as exc:
        return False, f"could not run systemctl ({exc.__class__.__name__})"
    state = (active.stdout or "").strip()
    return state == "active", f"service {state or 'unknown'}"


# --------------------------------------------------------------------------- smoke test
def looks_like_html(content_type: str, text: str) -> bool:
    """Cloudflare Access answers with an HTML page. That is an edge-auth failure,
    which is a different problem from a rejected token and must be reported as such."""
    if "text/html" in (content_type or "").lower():
        return True
    head = (text or "")[:512].lower()
    return any(marker in head for marker in ("<!doctype html", "<html", "cloudflare access"))


def _post_decision(base_url: str, project: str, token: str, body: bytes, timeout: float):
    """POST /v1/decision once. Returns (status, text, is_html, transport_error)."""
    req = urllib.request.Request(f"{base_url.rstrip('/')}/v1/decision", data=body, method="POST")
    req.add_header("content-type", "application/json")
    req.add_header("x-agent-project", project)
    req.add_header("x-agent-project-token", token)
    req.add_header("user-agent", "agent-core-rotate-smoke/1.0")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            text = resp.read().decode("utf-8", "replace")
            return resp.status, text, looks_like_html(resp.headers.get("content-type", ""), text), None
    except urllib.error.HTTPError as exc:
        try:
            text = exc.read().decode("utf-8", "replace")
        except Exception:                                             # noqa: BLE001
            text = ""
        ctype = exc.headers.get("content-type", "") if exc.headers else ""
        return exc.code, text, looks_like_html(ctype, text), None
    except Exception as exc:                                          # noqa: BLE001
        return 0, "", False, exc.__class__.__name__


def smoke_auth_only(base_url: str, project: str, token: str, timeout: float = 8.0):
    """Zero-cost credential probe: POST a deliberately malformed `{}` body.

    The service authenticates in a pre-handler *before* the body is validated, and
    `audit.write` only runs after a successful decision. So this exercises the
    credential path with no model-provider call and no decision audit row:

      valid token   -> 400 INVALID_REQUEST
      invalid token -> 401 UNAUTHORIZED
      missing scope -> 403 FORBIDDEN

    Returns (ok, kind, detail).
    """
    status, text, is_html, error = _post_decision(base_url, project, token, b"{}", timeout)
    if error:
        return False, SMOKE_BAD, error
    if is_html:
        return False, SMOKE_EDGE, (f"HTTP {status}: HTML from the edge, not a token verdict "
                                  "(Cloudflare Access is refusing the request)")
    if status == 400:
        return True, SMOKE_OK, "HTTP 400 INVALID_REQUEST (credential accepted, no provider call)"
    if status == 401:
        return False, SMOKE_TOKEN, "HTTP 401 UNAUTHORIZED (token rejected)"
    if status == 403:
        return False, SMOKE_TOKEN, "HTTP 403 FORBIDDEN (token accepted, scope denied)"
    return False, SMOKE_BAD, f"HTTP {status} unexpected for an auth-only probe"


def smoke(base_url: str, project: str, token: str, timeout: float = 8.0):
    """PAID functional probe: a real decision request that reaches the model provider.
    Opt-in via --smoke-functional; never run implicitly. Returns (ok, kind, detail)."""
    body = json.dumps({
        "project": project,
        "decision_type": "QA_DISPOSITION",
        "state": {"source": "post-rotation-smoke"},
        "question": {"type": "noul", "instructions": "post-rotation smoke test",
                     "true_when": "reachable", "false_when": "not reachable"},
    }).encode("utf-8")
    status, text, is_html, error = _post_decision(base_url, project, token, body, timeout)
    if error:
        return False, SMOKE_BAD, error
    if is_html:
        return False, SMOKE_EDGE, (f"HTTP {status}: HTML from the edge, not a decision "
                                   "(Cloudflare Access is refusing the request)")
    if status == 401:
        return False, SMOKE_TOKEN, "HTTP 401 UNAUTHORIZED (token rejected)"
    if status == 403:
        return False, SMOKE_TOKEN, "HTTP 403 FORBIDDEN (token accepted, scope denied)"
    if status != 200:
        return False, SMOKE_BAD, f"HTTP {status}"
    try:
        payload = json.loads(text)
    except ValueError:
        return False, SMOKE_BAD, f"HTTP {status} but the body is not JSON"
    if not isinstance(payload, dict) or "disposition" not in payload:
        return False, SMOKE_BAD, f"HTTP {status} but the body is not a decision"
    return True, SMOKE_OK, f"HTTP {status} disposition={payload['disposition']}"


def run_smoke(base_url: str, project: str, token: str, functional: bool, timeout: float = 8.0):
    """(ok, kind, detail). functional=False is the zero-cost auth-only probe."""
    if functional:
        return smoke(base_url, project, token, timeout)
    return smoke_auth_only(base_url, project, token, timeout)


def smoke_line(project: str, kind: str, detail: str) -> str:
    label = {SMOKE_OK: "OK  ", SMOKE_TOKEN: "FAIL", SMOKE_EDGE: "EDGE", SMOKE_BAD: "FAIL"}[kind]
    return f"  smoke {project:32s} {label} {detail}"


def smoke_targets(base_url: str, targets, keys: dict, functional: bool) -> tuple[int, int]:
    """Announce the mode, then print one line per target. Returns (bad, edge) counts."""
    print("smoke mode: functional (PAID — reaches the model provider)"
          if functional else
          "smoke mode: auth-only (zero cost — no provider call, no decision audit row)")
    bad = edge = 0
    for project in targets:
        ok, kind, detail = run_smoke(base_url, project, keys[project], functional)
        print(smoke_line(project, kind, detail))
        if kind == SMOKE_EDGE:
            edge += 1
        elif not ok:
            bad += 1
    return bad, edge


def smoke_verdict(bad: int, edge: int) -> int:
    if edge:
        print("! the edge refused the request before it reached agent-core. This is a Cloudflare\n"
              "! Access problem, not a token problem: fix the edge before judging the credential.",
              file=sys.stderr)
        return EXIT_EDGE
    if bad:
        return EXIT_SMOKE
    return EXIT_OK


# --------------------------------------------------------------------------- planning
def plan_rotation(lines: list[str], only: list[str] | None) -> tuple[dict, dict, list[str], list[str]]:
    """Return (keys, scopes, targets, warnings). Never silently widens or narrows."""
    assert_single_keys_line(lines)
    keys = json_var(lines, KEY_VAR)
    if not keys:
        raise Refuse(f"FAIL: {KEY_VAR} is empty; refusing to guess the project set")
    scopes = json_var(lines, SCOPE_VAR, required=False)
    warnings: list[str] = []

    if only:
        targets = list(dict.fromkeys(only))
        missing = [p for p in targets if p not in keys]
        if missing:
            raise Refuse(f"FAIL: requested project(s) not present in {KEY_VAR}: {', '.join(missing)}")
        skipped = [p for p in keys if p not in targets]
        if skipped:
            warnings.append(f"targeted rotation: leaving {len(skipped)} untouched ({', '.join(sorted(skipped))})")
    else:
        targets = list(dict.fromkeys([*keys, *PROJECTS]))
        if len(targets) > 1:
            warnings.append(f"fleet-wide rotation: {len(targets)} projects; use --only for a smaller blast radius")

    for project in targets:
        if project not in scopes:
            warnings.append(f"{project} has no {SCOPE_VAR} entry; the new token will authorise nothing")
    return keys, scopes, targets, warnings


def write_keys(lines: list[str], keys: dict) -> str:
    out = [(KEY_VAR + "=" + json.dumps(keys, separators=(",", ":")))
           if line.startswith(KEY_VAR + "=") else line for line in lines]
    return "\n".join(out) + "\n"


# --------------------------------------------------------------------------- commands
def cmd_rollback(args) -> int:
    if args.dry_run:
        print(f"DRY RUN — would restore {args.env_file} from {os.path.basename(args.rollback)}")
        return EXIT_OK
    text = decrypt_backup(args.rollback)
    assert_single_keys_line(text.splitlines())
    atomic_write(args.env_file, text)
    keys = json_var(text.splitlines(), KEY_VAR)
    print(f"rollback: restored {args.env_file} with {len(keys)} projects "
          f"(mode {mode_of(args.env_file)})")
    ok, msg = restart_service(args.no_restart)
    print(f"service: {msg}")
    if not ok:
        return EXIT_RESTART
    if args.base_url:
        bad, edge = smoke_targets(args.base_url, sorted(keys), keys, args.smoke_functional)
        return smoke_verdict(bad, edge)
    return EXIT_OK


def cmd_restart_only(args) -> int:
    """Roll forward: complete a rotation whose restart or smoke step was interrupted."""
    lines = read_env(args.env_file)
    keys, _scopes, targets, _warnings = plan_rotation(lines, args.only_projects())
    print(f"resuming rotation for {len(targets)} project(s); the env file is not modified")
    ok, msg = restart_service(args.no_restart)
    print(f"service: {msg}")
    if not ok:
        return EXIT_RESTART
    if args.base_url:
        bad, edge = smoke_targets(args.base_url, targets, keys, args.smoke_functional)
        return smoke_verdict(bad, edge)
    return EXIT_OK


def cmd_smoke(args) -> int:
    if not args.base_url:
        raise Refuse("FAIL: --smoke needs --base-url")
    lines = read_env(args.env_file)
    keys, _scopes, targets, _warnings = plan_rotation(lines, args.only_projects())
    bad, edge = smoke_targets(args.base_url, targets, keys, bool(args.smoke_functional))
    return smoke_verdict(bad, edge)


def is_production_env(env_file: str, args=None) -> bool:
    """True when this run targets the production host layout.

    The VPS uses the default env path with its own HOME, so a default-path run is a
    production run. AGENT_CORE_ENV=production is the explicit signal (config.ts treats
    that value as production), and --production forces it for a non-default path.
    A run against an explicit --env-file elsewhere only warns.
    """
    if getattr(args, "production", False):
        return True
    if str(os.environ.get("AGENT_CORE_ENV", "")).strip().lower() == "production":
        return True
    try:
        return os.path.realpath(env_file) == os.path.realpath(default_env_file())
    except OSError:
        return False


BREAK_GLASS_BANNER = (
    "!" * 74,
    "! BREAK-GLASS: rotating WITHOUT an encrypted backup.",
    "! This rotation CANNOT be rolled back. If a consumer is missed there is no",
    "! previous token to restore, and every affected identity must be re-issued.",
    "!" * 74,
)


def cmd_rotate(args) -> int:
    lines = read_env(args.env_file)
    check_mode_600(args.env_file)
    keys, _scopes, targets, warnings = plan_rotation(lines, args.only_projects())
    old_fp = {p: fp(keys[p]) for p in targets}

    print(f"DRY RUN — would rotate {len(targets)} project tokens; nothing written"
          if args.dry_run else f"rotating {len(targets)} project tokens")
    for project in targets:
        print(f"  {project:32s} prev=sha256:{old_fp[project]}")
    for warning in warnings:
        print(f"  ! {warning}")

    recipients = args.backup_recipient or [
        r for r in os.environ.get("AGENT_CORE_BACKUP_RECIPIENT", "").split(",") if r.strip()]
    if not recipients:
        if is_production_env(args.env_file, args) and not args.break_glass_no_backup:
            raise Refuse(
                "FAIL: refusing to rotate in production without --backup-recipient.\n"
                "      A rotation without a backup cannot be undone: if a consumer is missed,\n"
                "      there is no previous token to restore and every affected identity must\n"
                "      be re-issued by hand.\n"
                "      Either pass --backup-recipient <age-or-gpg-recipient>, or accept an\n"
                "      unrecoverable rotation explicitly with --break-glass-no-backup.")
        if args.break_glass_no_backup:
            for line in BREAK_GLASS_BANNER:
                print(line)
        else:
            print("  ! no --backup-recipient: rotating WITHOUT a backup (rotation is not reversible)")

    if args.dry_run:
        return EXIT_OK

    backup = None
    if recipients:
        backup = backup_encrypted(args.env_file, args.backup_dir, recipients)
        print(f"backup: {os.path.basename(backup)} (encrypted, mode {mode_of(backup)})")

    new_keys = {**keys, **{p: secrets.token_hex(32) for p in targets}}
    atomic_write(args.env_file, write_keys(lines, new_keys))
    print(f"rotated {len(new_keys)} project tokens (mode {mode_of(args.env_file)})")
    for project in targets:
        print(f"  {project:32s} new=sha256:{fp(new_keys[project])} prev=sha256:{old_fp[project]}")

    ok, msg = restart_service(args.no_restart)
    print(f"service: {msg}")
    if not ok:
        print("! the env file WAS changed but the service is not confirmed active.")
        print("! recover: --rollback the backup above, or fix and rerun with --restart-only",
              file=sys.stderr)
        return EXIT_RESTART

    if args.base_url:
        bad, edge = smoke_targets(args.base_url, targets, new_keys, args.smoke_functional)
        code = smoke_verdict(bad, edge)
        if code:
            print("! smoke failed: the new token is not confirmed. Roll back.", file=sys.stderr)
            return code
    return EXIT_OK


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--env-file", default=None,
                    help="env file to rotate (default: $HOME/.config/agent-core/agent-core.env)")
    ap.add_argument("--dry-run", action="store_true", help="show what would rotate; write nothing")
    ap.add_argument("--apply", action="store_true",
                    help="accepted for explicitness; rotation already requires the absence of --dry-run")
    ap.add_argument("--no-restart", action="store_true", help="do not restart agent-core.service")
    ap.add_argument("--only", help="comma-separated project ids; default is every project")
    ap.add_argument("--backup-dir", default=None,
                    help="directory for encrypted backups (default: $HOME/.config/agent-core/backups)")
    ap.add_argument("--backup-recipient", action="append", default=[],
                    help="age or gpg recipient for the encrypted backup (repeatable)")
    ap.add_argument("--base-url", default=os.environ.get("AGENT_CORE_SMOKE_URL", ""),
                    help="run the smoke check per rotated project (auth-only by default)")
    ap.add_argument("--smoke-functional", action="store_true",
                    help="make the smoke a PAID decision request that reaches the model provider; "
                         "without this the smoke is the zero-cost auth-only probe")
    ap.add_argument("--production", action="store_true",
                    help="treat this run as production (forces the --backup-recipient requirement "
                         "even for a non-default --env-file)")
    ap.add_argument("--break-glass-no-backup", action="store_true",
                    help="allow a PRODUCTION rotation with no encrypted backup; the rotation then "
                         "cannot be rolled back")
    ap.add_argument("--smoke", action="store_true", help="only run the smoke test")
    ap.add_argument("--restart-only", action="store_true",
                    help="roll forward: restart and smoke-test without rotating")
    ap.add_argument("--rollback", metavar="BACKUP_FILE", help="restore the env file from a backup")
    args = ap.parse_args()
    if not args.env_file:
        args.env_file = default_env_file()
    if not args.backup_dir:
        args.backup_dir = default_backup_dir()
    args.only_projects = lambda: [p.strip() for p in args.only.split(",") if p.strip()] if args.only else None

    try:
        if args.rollback:
            return cmd_rollback(args)
        if args.smoke:
            return cmd_smoke(args)
        if args.restart_only:
            return cmd_restart_only(args)
        return cmd_rotate(args)
    except Refuse as exc:
        print(str(exc), file=sys.stderr)
        return EXIT_REFUSED


if __name__ == "__main__":
    sys.exit(main())
