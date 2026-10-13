# Next session — resume guide

**Start from:** `git fetch origin && git checkout main && git pull` (this note was written at `93afa3e`; pull if `main` has moved).

Production pointer, re-check before any deploy:

```bash
readlink -f ~/agent-core/current
cat ~/agent-core/current/RELEASE_SHA
curl -sS -m 3 http://127.0.0.1:8787/v1/health
```

Expected on 2026-10-13: `releases/dbe20a5`, SHA `dbe20a5543c07996aafc9f39ceb050007ce79842`, `"version":"0.7.0"`.

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

1. **Phase-C knowledge WIP** — apply `git stash list` → `consolidation-preserve-wip-20261013-1743` onto a branch from current `main`.
2. **Retire or archive** `docs/reality-reconciliation-20261013` after porting any unique docs (e.g. `POST_AUDIT_CLOSURE.md`).
3. **Doc hygiene:** refresh `docs/rea/LOCAL_PREFLIGHT.md` post-install; keep `JEV_REA_ROUTING_V2.md` status aligned with `main`.

## WIP locations

- UNIQUE patch backup: `F:\projectAi\REA\backups\agent-core-unique-wip-20261013-final\unique-wip.patch`
- Stashes: `final-sync-preserve-wip-20261013`, `consolidation-preserve-wip-20261013-1743`
- Do **not** commit `.env` or `F:\projectAi\REA\out\*.json`

## Unresolved

- Production is `dbe20a5` (8 capabilities, 6 projects, rollback `01092e2`). Commits after that SHA, including REA routing, are not deployed. The morning audit's "SHA unknown" line is historical.
- Stale worktrees (`agent-core-main-sync` @ old main) — update or remove after backup.
