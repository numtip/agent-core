# Next session — resume guide

**Start from:** `git fetch origin && git checkout main && git pull` (expect `8e77ab5` or newer).

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

- Production deployment unchanged; edge audit in `AGENT_CORE_REALITY_AUDIT_20261013.md` is point-in-time morning snapshot.
- Stale worktrees (`agent-core-main-sync` @ old main) — update or remove after backup.
