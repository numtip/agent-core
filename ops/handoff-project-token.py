#!/usr/bin/env python3
"""Hand off ONE project token from this host (Agent Core) to a
reviewed destination on the target host, over ssh **stdin**.

Security properties (all enforced in code, not by convention):
  * the token is read from the mode-600 env file into Python memory and written
    to the remote file over `ssh` stdin -> never in argv, never in a local temp
    file, never in a shell pipeline, never in stdout/logs/journal;
  * only sha256 prefixes, lengths, modes, owners and sizes are ever printed;
  * the destination must be an absolute path, may not contain '..', must end in
    the expected filename, and may not exist yet (no silent overwrite) nor be a
    symlink (no symlink retarget attack) -> remote `set -C` (noclobber) + `[ -L ]`;
  * the destination must NOT sit inside a git worktree unless the path is
    explicitly ignored there (`git check-ignore`) - a secret must never be
    committable by accident;
  * the destination must not be inside an existing production runtime tree
    (default deny list, overridable only with an explicit flag);
  * the parent directory is created with mode 0700, the token file with 0600;
  * the payload lands in a 0600 temp file **in the destination directory**, is
    verified (mode + sha256) BEFORE the rename, and is only then renamed into
    place. A failure before the rename leaves an existing token untouched, and
    the temp file is always removed (EXIT trap);
  * verification re-reads only metadata + sha256 on the remote side; the value
    is never transmitted back.

Existing destinations are refused unless `--replace` is given, and `--replace`
itself is refused unless `--apply` is also given: replacing a live credential is
a deliberate act, never a side effect of re-running a delivery.

  python3 handoff-project-token.py --dest /abs/path/agent-core.token            # DRY RUN (default)
  python3 handoff-project-token.py --dest /abs/path/agent-core.token --apply
  python3 handoff-project-token.py --dest /abs/path/agent-core.token --apply --replace
  python3 handoff-project-token.py --dest /abs/path/agent-core.token --verify-only
"""
import argparse
import hashlib
import json
import os
import posixpath
import shlex
import subprocess
import sys

SSH_TARGET = os.environ.get("HANDOFF_SSH_TARGET", "vps190")
PROJECT = os.environ.get("HANDOFF_PROJECT", "rae-attendance-v2")
ENV_FILE = os.path.expanduser("~/.config/agent-core/agent-core.env")
# sha256(token)[:12] recorded at activation; supplied by the operator, never stored in Git.
EXPECT_FP = os.environ.get("HANDOFF_EXPECT_FP", "")
BASENAME = os.environ.get("HANDOFF_BASENAME", "agent-core.token")
# Paths that must never receive the secret (production runtimes on the target).
DENY_PREFIXES = ("/home/rae_admin/rae-attendance-v2-runtime",
                 "/home/rae_admin/RAE-Attendance-System-V2",
                 "/home/rae_admin/real-attendance-system")


def fp(v: str) -> str:
    return hashlib.sha256(v.encode()).hexdigest()[:12]


def load_token() -> tuple[str, list[str]]:
    kv = {}
    with open(ENV_FILE) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                kv[k] = v
    return (json.loads(kv["AGENT_CORE_PROJECT_KEYS"])[PROJECT],
            json.loads(kv["AGENT_CORE_PROJECT_SCOPES"])[PROJECT])


def load_payload(src_file: str | None) -> tuple[bytes, str, str]:
    """Return (payload bytes, sha256 prefix, description).

    Default source is the project token in the protected env file. With
    --src-file the payload is the exact bytes of a local 0600 file (used for a
    multi-line secret bundle such as a CF-Access client id/secret pair), so no
    value is ever transposed on the command line.
    """
    if src_file:
        try:
            st = os.stat(src_file)
        except OSError as e:
            sys.exit(f"REFUSING: cannot read source file {src_file} ({e.strerror})")
        if oct(st.st_mode)[-3:] != "600":
            sys.exit(f"REFUSING: source file {src_file} must be mode 600 (is {oct(st.st_mode)[-3:]})")
        data = open(src_file, "rb").read()
        if not data or len(data) > 8192:
            sys.exit("REFUSING: source file empty or implausibly large")
        return data, hashlib.sha256(data).hexdigest()[:12], f"file {src_file} ({len(data)} bytes)"
    token, scopes = load_token()
    return token.encode(), fp(token), f"project {PROJECT} scopes={scopes}"


def ssh(cmd: str, stdin_bytes: bytes | None = None):
    p = subprocess.run(["ssh", "-o", "BatchMode=yes", SSH_TARGET, cmd],
                       input=stdin_bytes, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return p.returncode, p.stdout.decode(), p.stderr.decode()


def check_dest(dest: str) -> list[str]:
    errs = []
    if not dest.startswith("/"):
        errs.append("dest must be absolute (ssh does not expand ~)")
    if ".." in dest.split("/"):
        errs.append("dest must not contain '..' (path traversal)")
    if dest != posixpath.normpath(dest):
        errs.append("dest must be a normalised path (no '//', '/./' or trailing '/')")
    if os.path.basename(dest) != BASENAME:
        errs.append(f"dest must end in /{BASENAME}")
    norm = posixpath.normpath(dest)
    for p in DENY_PREFIXES:
        if norm == p or norm.startswith(p + "/"):
            errs.append(f"dest is inside a production runtime tree: {p}")
    return errs


def remote_preflight(dest: str) -> tuple[bool, str]:
    """Read-only checks on the target: existence, symlink, git visibility."""
    d = shlex.quote(dest)
    parent = shlex.quote(os.path.dirname(dest))
    cmd = (
        f"if [ -e {d} ] || [ -L {d} ]; then echo 'EXISTS'; fi; "
        f"if [ -L {parent} ] || [ -L {d} ]; then echo 'SYMLINK'; fi; "
        f"p=$(dirname {d}); while [ ! -d \"$p\" ] && [ \"$p\" != / ]; do p=$(dirname \"$p\"); done; "
        f"top=$(git -C \"$p\" rev-parse --show-toplevel 2>/dev/null); "
        f"if [ -n \"$top\" ]; then echo \"GITREPO:$top\"; "
        f"  if git -C \"$p\" check-ignore -q {d} 2>/dev/null; then echo 'GITIGNORED'; else echo 'GITUNIGNORED'; fi; "
        f"else echo 'NOGITREPO'; fi"
    )
    rc, out, err = ssh(cmd)
    return rc == 0, (out + err).strip()


# The remote write: 0600 temp file in the destination directory -> verify mode and
# sha256 -> atomic rename. Any failure before the rename exits non-zero and leaves
# an existing destination untouched; the EXIT trap removes the temp file either way.
#
# Placeholders use @@NAME@@ sentinels rather than %-formatting because the script
# itself contains `stat -c '%a'` / `'%U'` / `'%s'`.
REMOTE_WRITE = r"""umask 077
parent=@@PARENT@@
d=@@DEST@@
tmp="$parent/.@@BASENAME@@.incoming.$$"
cleanup() { [ -e "$tmp" ] && rm -f "$tmp"; return 0; }
trap cleanup EXIT HUP INT TERM
mkdir -p "$parent" && chmod 700 "$parent" || exit 20
if [ -e "$tmp" ] || [ -L "$tmp" ]; then exit 21; fi
( set -C; cat > "$tmp" ) || exit 22
chmod 600 "$tmp" || exit 23
tmode=$(stat -c '%a' "$tmp" 2>/dev/null)
tsum=$(sha256sum "$tmp" | cut -c1-12)
[ "$tmode" = "600" ] || exit 24
[ "$tsum" = "@@EXPECT@@" ] || exit 25
if [ "@@REPLACE@@" != "1" ] && { [ -e "$d" ] || [ -L "$d" ]; }; then exit 26; fi
mv -f "$tmp" "$d" || exit 27
exit 0
"""


def remote_write_command(parent: str, dest: str, expect_fp: str, replace: bool) -> str:
    return (REMOTE_WRITE
            .replace("@@PARENT@@", shlex.quote(parent))
            .replace("@@DEST@@", shlex.quote(dest))
            .replace("@@BASENAME@@", BASENAME)
            .replace("@@EXPECT@@", expect_fp)
            .replace("@@REPLACE@@", "1" if replace else "0"))


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dest", required=True, help=f"remote ABSOLUTE path ending in {BASENAME}")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--replace", action="store_true",
                    help="allow replacing an existing destination file (requires --apply)")
    ap.add_argument("--verify-only", action="store_true")
    ap.add_argument("--src-file", help="local 0600 file whose exact bytes are the payload "
                                       "(default: the project token from the protected env)")
    a = ap.parse_args()

    errs = check_dest(a.dest)
    if errs:
        sys.exit("REFUSING (local checks): " + "; ".join(errs))

    if a.replace and not a.apply:
        sys.exit("REFUSING: --replace replaces a live credential and requires --apply")

    payload, expect_fp, desc = load_payload(a.src_file)
    print(f"payload={desc} sha256[:12]={expect_fp}")
    if not a.src_file and not EXPECT_FP:
        sys.exit("REFUSING: set HANDOFF_EXPECT_FP to the sha256[:12] recorded at activation")
    if not a.src_file and expect_fp != EXPECT_FP:
        sys.exit(f"REFUSING: fingerprint {expect_fp} != expected {EXPECT_FP} (unexpected rotation)")

    rc, out, err = ssh("hostname; whoami; id -u")
    print(f"recipient: rc={rc} {' / '.join(out.split())}")
    if rc != 0:
        sys.exit(f"REFUSING: ssh channel unusable: {err.strip()[:200]}")

    ok, pre = remote_preflight(a.dest)
    print(f"remote preflight: {pre.replace(chr(10), ' | ')}")
    if not ok:
        sys.exit("REFUSING: remote preflight failed")
    if "SYMLINK" in pre:
        sys.exit("REFUSING: destination or its parent is a symlink")
    if "GITREPO" in pre and "GITUNIGNORED" in pre:
        sys.exit("REFUSING: destination is inside a git worktree and is NOT ignored there "
                 "(add a local .git/info/exclude entry first, or choose another path)")

    if a.verify_only:
        d = shlex.quote(a.dest)
        rc, out, _ = ssh(f"stat -c '%a %U %s' {d} 2>&1; sha256sum {d} 2>/dev/null | cut -c1-12")
        print(f"verify(remote): {out.strip().replace(chr(10), ' | ')}")
        return

    if "EXISTS" in pre and not a.replace:
        sys.exit("REFUSING: destination already exists (pass --replace --apply to overwrite)")

    if not a.apply:
        action = "replace" if a.replace else "create"
        print(f"DRY RUN — would {action} {a.dest} (0600) on {SSH_TARGET} via ssh stdin, "
              "verifying mode+sha256 in a temp file before an atomic rename. Nothing written.")
        return

    remote = remote_write_command(os.path.dirname(a.dest), a.dest, expect_fp, a.replace)
    rc, out, err = ssh(remote, stdin_bytes=payload)
    if rc != 0:
        # The remote script validates before renaming, so a non-zero exit here means the
        # destination was not modified (or, with --replace, still holds the previous value).
        detail = (out + err).strip().splitlines()[:1]
        sys.exit(f"FAILED: remote write/verify rejected before rename rc={rc} "
                 f"{detail[0] if detail else ''} — destination unchanged")

    rc, out, err = ssh(f"stat -c '%a %U %s' {shlex.quote(a.dest)}; "
                       f"sha256sum {shlex.quote(a.dest)} | cut -c1-12")
    parts = out.split()
    mode = parts[0] if parts else "?"
    remote_fp = parts[-1] if parts else ""
    size = parts[2] if len(parts) > 2 else "?"
    print(f"verify(remote): mode={mode} owner={parts[1] if len(parts) > 1 else '?'} size={size} "
          f"sha256[:12]={remote_fp}")
    if rc != 0 or remote_fp != expect_fp or mode != "600":
        sys.exit(f"FAILED VERIFICATION: expected sha256[:12]={expect_fp} mode=600, got "
                 f"sha256[:12]={remote_fp} mode={mode} — delivery NOT confirmed (do not treat as complete)")
    print(f"HANDOFF COMPLETE — remote sha256[:12]={remote_fp} matches {expect_fp}, mode 600 verified; "
          "value never transmitted back and never printed")


if __name__ == "__main__":
    main()
