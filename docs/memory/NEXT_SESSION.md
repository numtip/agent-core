# Next session — resume guide

**Start from:** `git fetch origin && git checkout main && git pull` (this note was written at `607b41e230a25a99c3481702a4260738b8d354af`; pull if `main` has moved).

**Closeout:** `SECURITY_SOURCE_MERGED — PRODUCTION_PENDING`. Do not deploy, restart, rotate tokens, or change Cloudflare or MCP from this note.

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

1. **Do not deploy `607b41e`.** Production stays `dbe20a5`. A later release needs owner approval, then `AGENT_CORE_CF_ACCESS_TEAM_DOMAIN` and `AGENT_CORE_CF_ACCESS_AUD` before the symlink switch, or `/control` returns 503. The egress proxy is not installed. Rollback of that future release is `ln -sfn ~/agent-core/releases/dbe20a5 ~/agent-core/current` and a restart of `agent-core.service` only. See [../STATUS.md](../STATUS.md#security-closeout--2026-10-13).
2. **Token rotation is OWNER-MANAGED / PENDING.** Do not read credentials. The owner runs `python3 ~/agent-core/ops/rotate-project-tokens.py --dry-run` first, then a real rotation only if they approve it, then re-does the `rae-attendance-v2` handoff.
3. **PR #4 stays OPEN / CONFLICTING.** Do not rebase or close it. It overlaps PR #31 in four ops scripts; #31 is the newer git copy.
4. **Phase-C knowledge WIP** — apply `git stash list` → `consolidation-preserve-wip-20261013-1743` onto a branch from current `main`.
5. **Retire or archive** `docs/reality-reconciliation-20261013` after porting any unique docs (e.g. `POST_AUDIT_CLOSURE.md`).
6. **Doc hygiene:** refresh `docs/rea/LOCAL_PREFLIGHT.md` post-install; keep `JEV_REA_ROUTING_V2.md` status aligned with `main`.

## WIP locations

- UNIQUE patch backup: `F:\projectAi\REA\backups\agent-core-unique-wip-20261013-final\unique-wip.patch`
- Stashes: `final-sync-preserve-wip-20261013`, `consolidation-preserve-wip-20261013-1743`
- Do **not** commit `.env` or `F:\projectAi\REA\out\*.json`

## Unresolved

- Production is `dbe20a5` / `0.7.0` (8 capabilities, 6 projects, service rollback `01092e2`, MainPID `2891042`). `main` `607b41e` includes REA routing and the security/ops hardening. None of that is deployed. The morning audit's "SHA unknown" line is historical.
- Dev-only `vitest` advisories (3) are recorded and not upgraded. Production dependency audit is 0.
- Stale worktrees (`agent-core-main-sync` @ old main) — update or remove after backup.
