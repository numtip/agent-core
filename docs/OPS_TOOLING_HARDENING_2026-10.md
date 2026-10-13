# Ops tooling hardening — 2026-10

Brings the operator scripts that were fixed in place on the Agent Core host
(`~/agent-core/ops/`, audit 2026-10-13) under version control, parameterised for a public repo,
with a regression suite that uses synthetic credentials only.

## Defects fixed

| Sev | Script | Baseline defect | Fix |
|---|---|---|---|
| High | `rotate-project-tokens.py` | Rotated a hardcoded list of 5 projects; running it dropped the live `rae-attendance-v2` key | Rotates every key present; atomic 0600 write; `--dry-run`, `--no-restart` |
| Med | `inject-openrouter-key.sh` | Key passed in argv (readable via `/proc/<pid>/cmdline`) | Key passed via env; atomic 0600 write |
| Med | `activate-user-space.sh` | Created files under the default umask | `umask 077` |
| Med | `handoff-project-token.py` | Deny-list bypass via `//` or `/./`; dry run said "would create" for an existing dest | Normalised path required; boundary-safe prefix match; EXISTS checked first |
| Med | `normalise-cf-access-bundle.py` | Non-atomic overwrite of an unrecoverable secret; duplicate aliases silently collapsed | Atomic write; refuses duplicates |
| Med | `validate-cf-access-bundle.py` | Empty secret gave `PASS`; always exit 0 | Empty/duplicate/CRLF are problems; exit 1 |
| Med | `cf-access-snapshot.py` | API failure produced an empty but valid-looking rollback snapshot | `complete`/`failures` in MANIFEST; exit 1 if incomplete |
| Med | `j2c7-preflight.py` | `APPLY READY` ignored failed snapshot integrity; crashed on a new app | Integrity gates readiness; unknown app = drift |
| Low | `j2c8-policy-verify.py` | IndexError before verdict; no exit code | Safe access; exit 1 on FAIL |
| Low | `j2c5-access-probe.py` | COMPAT used the wrong status (could print "NOBODY"); crashed on an unnamed app | Uses inventory status, prints UNKNOWN; name guarded |
| Low | `j2c6-edge-probe.py` | Crash when curl wrote no body | Guarded |
| Low | `qa-local.py` | Exit 0 on failure; fixed audit path; crashed on corrupt audit lines | Exit code; `AGENT_CORE_AUDIT_LOG`; corrupt lines counted |

## Differences from the deployed copies

The tracked scripts are the deployed fixes plus the changes below. The deployed copies in
`~/agent-core/ops/` were **not** modified (backup: `~/agent-core/backups/ops-audit-20261013-223304/`).

| Change | Why |
|---|---|
| Cloudflare IDs now come from required env vars: `CF_ACCOUNT_ID`, `CF_MACHINE_APP_ID`, `CF_MACHINE_POLICY_ID`, `CF_ACCESS_SNAPSHOT_DIR` | The repo is public. Scripts exit with `REFUSING: set CF_…` when a value is unset |
| `HANDOFF_EXPECT_FP` is required and has no default | No token fingerprint is stored in Git |
| `CF_API_BASE`, `CF_ACCESS_BACKUP_ROOT`, `AGENT_CORE_EDGE_BASE` overrides | Lets the tests use a local fake API instead of Cloudflare or the public edge |
| `inject-openrouter-key.sh`: `INJECT_SRC`/`INJECT_DEST` default to `$HOME/...`; `INJECT_NO_RESTART=1` | No hardcoded home path; testable without a restart |
| `cf-access-snapshot.py`: `captured_on` is the hostname | No internal IP in Git |
| `qa-local.py`: the bind check uses the port from `BASE`. Section 8 expects `/control` and `/v1/control-metrics` to **fail closed** at the origin | Matches the origin-auth hardening on `fix/security-runtime-hardening`. Use `QA_LEGACY_OPEN_CONTROL=1` for releases before it, such as `dbe20a5` |

Operators who promote these copies to the host must export the CF variables (values are
in the operator's notes, not in Git).

## Overlap with PR #4

PR #4 (`ops/production-activation`, older lineage) also touches `activate-user-space.sh`,
`inject-openrouter-key.sh`, `qa-local.py` and `rotate-project-tokens.py`. This branch is based on
`origin/main` and supersedes those four files. Decide whether to close PR #4 or rebase it onto this branch.

## Verification

```bash
python3 -m unittest discover -s ops/tests -v     # 19 tests, synthetic credentials, temp HOME
python3 ops/test_handoff_guards.py              # 16/16 (also run by the suite)
```

The suite covers:
- **rotate:** dry run writes nothing; every onboarded project is kept; mode 600; no temp files left; unrelated lines preserved; no values printed; refuses an ambiguous env.
- **inject:** the key is never in any argv; mode 600; exit code when the key is missing.
- **activate:** 700/600 modes; idempotent rerun.
- **validate/normalise:** verdicts and exit codes; atomic; values never printed.
- **snapshot:** complete vs incomplete; secret stripping; SHA256SUMS.
- **j2c5/j2c7/j2c8:** verdicts against a fake Cloudflare API.
- **handoff:** refusal without an operator fingerprint.

Integration: `qa-local.py` against an isolated build of the hardened branch on `127.0.0.1:18087`,
with a temp HOME and synthetic keys, gave 21/21 PASS. Synthetic keys appeared 0 times in the QA output,
app log and audit log. Evidence: `docs/evidence/ops-hardening/qa-local-hardened-build.txt`.

## Rollback

These are operator tools; nothing runs them automatically. To roll back, revert the merge commit.
The deployed copies on the host are independent of this branch.
