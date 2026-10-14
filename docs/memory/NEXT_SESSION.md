# Next session — resume guide

**Start from:** `git fetch origin && git checkout main && git pull` (this note was written at `cb4ff559a2263bdfcb1de8c1f7fd4f92caafc423`; pull if `main` has moved).

**Closeout 2026-10-14:** rotation and handoff tooling hardened (#34, #35), unauthorized-overwrite
recurrence closed (#36, **open**). Production unchanged at `dbe20a5`. Cursor live activation is
**BLOCKED on credentials**. Do not deploy, restart, rotate tokens, or change Cloudflare, MCP, or the
egress proxy from this note.

## Immediate next step

Provision the two existing credentials into the local DPAPI store, then verify live
`TASK_ROUTE`, `NEXT_ACTION`, `QA_DISPOSITION`. **Do not redesign SSO.** See
[2026-10-14.md](./2026-10-14.md#cursor-live-activation--blocked-on-credentials-verified) for the
measured layer map and the exact missing items.

The local adapter workspace (`G:\ProjectAI\agent-core-local`) is **not published** and must not be
committed here. It holds the DPAPI-backed adapter, the mock QA (28/28), and the ops handoff. Its
private key material is at `%USERPROFILE%\.age\keys.txt` — never copy, print or commit that.

## Standing instruction: activation does not rotate or weaken anything

The blocked integration is fixed by **issuing and handing over** credentials, not by rotating
tokens or relaxing Cloudflare policy. Token rotation is DEFERRED by owner decision; that is an
accepted risk, not permission to change policy to work around it. Preserve the existing production
security controls.

Production pointer, re-check before any deploy:

```bash
readlink -f ~/agent-core/current
cat ~/agent-core/current/RELEASE_SHA
curl -sS -m 3 http://127.0.0.1:8787/v1/health
```

Expected until an approved release: `releases/dbe20a5`, SHA `dbe20a5543c07996aafc9f39ceb050007ce79842`, `"version":"0.7.0"`, `agent-core` MainPID `2891042` (active since 2026-10-12 13:03:42 +07). A changed PID means someone restarted the service after this note.

## Quick commands

```bash
cd F:/projectAi/agent-core
npm ci && npm run build && npm test
```

Optional live Jev smoke (never log keys):

```bash
# .env must set OPENROUTER_API_KEY and REA_LOCAL_HANDOFF_ENABLED=true
LIVE_JEV_REA=1 node --env-file=.env npm test -- tests/jev-rea-live.integration.test.ts
```

REA MCP checks: see `F:\projectAi\REA\README.md` (Cursor `user-rea`).

## Priorities

0. **Cursor live activation (today's blocker).** Provision the existing Cloudflare Access MACHINE
   service token and one project token into the local DPAPI store, then verify live `TASK_ROUTE`,
   `NEXT_ACTION`, `QA_DISPOSITION`. **Do not redesign SSO, do not rotate tokens, do not change
   Cloudflare policy to unblock it** — issue and hand over the credentials instead. Details in
   [2026-10-14.md](./2026-10-14.md).
1. **Do not deploy `main`.** Production stays `dbe20a5`. Gate: owner approval, then set `AGENT_CORE_CF_ACCESS_TEAM_DOMAIN` and `AGENT_CORE_CF_ACCESS_AUD` before the symlink switch, or `/control` returns 503. The egress proxy and a browser-MCP `--proxy-server` change are a separate approval. Rollback of that future release is `ln -sfn ~/agent-core/releases/dbe20a5 ~/agent-core/current` and a restart of `agent-core.service` only. See [../STATUS.md](../STATUS.md) and [../SECURITY_HARDENING_2026-10.md](../SECURITY_HARDENING_2026-10.md).
2. **Token rotation is DEFERRED** by owner decision (2026-10-14). The six exposed identities remain
   unrotated as an accepted risk. If it is ever resumed: do not read credentials, run
   `ops/rotate-project-tokens.py --dry-run` first, then rotate only with approval, then re-do the
   `rae-attendance-v2` handoff. The merged tooling now refuses a production rotation without
   `--backup-recipient`.
3. **Merge PR #36** when reviewed — it closes the unauthorized-overwrite recurrence (`--replace`
   now needs `--confirm-replace`). CI green.
4. **PR #4 stays OPEN / CONFLICTING.** Do not rebase or close it. It overlaps PR #31 in four ops scripts; #31 is the newer git copy. REA activation on the VPS is also a separate approval (`REA_LOCAL_HANDOFF_ENABLED` stays false until then).
5. **Phase-C knowledge WIP** — apply `git stash list` → `consolidation-preserve-wip-20261013-1743` onto a branch from current `main`.
6. **Retire or archive** `docs/reality-reconciliation-20261013` after porting any unique docs (e.g. `POST_AUDIT_CLOSURE.md`).
7. **Doc hygiene:** refresh `docs/rea/LOCAL_PREFLIGHT.md` post-install; keep `JEV_REA_ROUTING_V2.md` status aligned with `main`.

## WIP locations

- UNIQUE patch backup: `F:\projectAi\REA\backups\agent-core-unique-wip-20261013-final\unique-wip.patch`
- Stashes: `final-sync-preserve-wip-20261013`, `consolidation-preserve-wip-20261013-1743`
- Do **not** commit `.env` or `F:\projectAi\REA\out\*.json`

## Unresolved

- Production is `dbe20a5` / `0.7.0` (8 capabilities, 6 projects, service rollback `01092e2`, MainPID `2891042`). `main` `c1411eb` includes REA routing and the security/ops hardening (`607b41e` / `0b8eed9`). None of that is deployed. The morning audit's "SHA unknown" line is historical.
- Local worktrees left in place: `agent-core` (untracked `package-lock.json` on `ops/production-activation`), `agent-core-j2c9b` (uncommitted edits on detached `dbe20a5`), `agent-core-audit` and `agent-core-ops` (merged branch tips). Do not delete them to "clean up" without a backup.
- Dev-only `vitest` advisories (3) are recorded and not upgraded. Production dependency audit is 0.
- Stale worktrees (`agent-core-main-sync` @ old main) — update or remove after backup.
