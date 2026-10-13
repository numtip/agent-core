# WIP reconciliation — final (Agent Core × REA)

**Status:** `A_RECONCILED` (documentation and disposition; code WIP tracked separately)  
**Baseline GitHub `main`:** `93a4a361b115da15d146b4fe4d927b1f51324a68` (PR #24 squash)  
**Canonical workspace:** `F:\projectAi\agent-core`  
**Date:** 2026-10-13

## Current gates

| Gate | State |
|------|--------|
| GitHub PR #24 | Merged → `93a4a36` |
| Jev × REA local routing (v1) | On `main`; fail-closed by default |
| REA Cursor MCP | Operational locally (`F:\projectAi\REA`; see `PREFLIGHT_STATUS.md`) |
| Production / VPS / Cloudflare | **Not updated** (out of scope) |

## WIP classification (pre-cleanup)

| Path | Class | Action |
|------|--------|--------|
| `src/rea-local/path-guard.ts`, REA tests, `tests/fixtures/rea-workspace/*` | **already-on-main** | Drop duplicate dirty deltas; keep `main` bytes |
| `.env.example`, `schemas/openapi.yaml`, `src/projects.ts`, `tests/knowledge-fabric.test.ts` | **unique-local** | Separate Phase-C / knowledge PR (not merged here) |
| `docs/audits/JEV_REA_GITHUB_CLOSEOUT.md` | **unique-local** | Committed in doc PR |
| `docs/audits/LOCAL_SYNC_RECONCILIATION.md`, `REA_SECURITY_PREFLIGHT.md` | **historical evidence** | Committed as-is; pre-install vs post-install called out in index |
| `docs/audits/WORKSPACE_CONSOLIDATION.md` | **historical evidence** | Local merge narrative vs GitHub squash |
| `stash@{1}` `consolidation-preserve-wip-20261013-1743` | **preserved** | **Not dropped** — Phase-C knowledge WIP |
| `stash@{0}` `mission-ac-wip-20261013` | **preserved** | Snapshot before mission A/C branches |
| `F:\projectAi\REA\backups\agent-core-wip-20261013-consolidation\` | **verified backup** | Rollback mirror + patch |

## Branch strategy

- **`docs/wip-reconciliation-final`** — audit index + closeout artifacts (this file, README, historical audits).
- **`feat/jev-rea-routing-v2`** — routing profile v2 + tests (separate PR).
- **`docs/reality-reconciliation-20261013` @ `0704443`** — legacy reconciliation; **do not merge** wholesale (superseded by `93a4a36` for REA code). Cherry-pick docs only as needed.

## Live evidence pointers (not in git)

- `F:\projectAi\REA\out\jev-rea-live-correlated.json` — `JEV_REA_LOCAL_READY`
- `F:\projectAi\REA\out\jev-live-route-handoff.json` — `ALLOW_HANDOFF` receipt
- `F:\projectAi\REA\INSTALLATION_REPORT.md` — install log

## Human-last items

- Phase-C knowledge WIP (`.ai/`, `src/knowledge-fabric.ts`, etc.) remains in **stash@{1}** until a dedicated PR is opened.
- Refresh `docs/rea/LOCAL_PREFLIGHT.md` checkboxes in a follow-up doc PR after human review.

## Rollback

1. Restore from `F:\projectAi\REA\backups\agent-core-wip-20261013-consolidation\git-diff-staged-unstaged.patch`
2. `git checkout main` @ `93a4a36` for known-good REA routing v1
3. Re-apply stash entries only with explicit approval
