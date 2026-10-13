# Workspace consolidation audit (2026-10-13)

## Canonical paths (policy)

| Role | Path |
|------|------|
| Agent Core + Jev | `F:\projectAi\agent-core` |
| REA MCP + local artifacts | `F:\projectAi\REA` |

No new clones or worktrees were created during this consolidation.

---

## Phase 1 — Audit summary

### Canonical repo (`F:\projectAi\agent-core`)

| Item | Value |
|------|--------|
| Branch (before merge) | `docs/reality-reconciliation-20261013` @ `dadbff7` |
| Branch (after merge) | `docs/reality-reconciliation-20261013` @ `0704443` |
| Dirty WIP | Modified tracked files + untracked `.ai/`, `adapters/`, audit docs, tests |

### PR #24

| Item | Value |
|------|--------|
| GitHub | https://github.com/numtip/agent-core/pull/24 |
| Branch | `feat/jev-rea-local-routing` |
| Commit | `da5cb2b` (unchanged on remote) |
| Worktree path | `F:\projectAi\agent-core-wt-jev-rea` (same repo, registered worktree) |

### Registered worktrees (classification)

| Path | HEAD / branch | Class | Notes |
|------|----------------|-------|-------|
| `F:\projectAi\agent-core` | `docs/reality-reconciliation-20261013` | **ACTIVE (canonical)** | Sole dev workspace |
| `F:\projectAi\agent-core-wt-jev-rea` | `feat/jev-rea-local-routing` @ `da5cb2b` | **REDUNDANT** (post-merge) | Removed if `git worktree remove` succeeded |
| `F:\projectAi\agent-core-closure-qa` | detached `7268f13` | **REDUNDANT** | Commit reachable from history; only untracked `package-lock.json` |
| `F:\projectAi\agent-core-main-sync` | detached `c3666b7` | **REDUNDANT** | Same as `origin/main` |
| `F:\projectAi\agent-core-phase-c` | `feat/phase-c-knowledge-observation` | **RETAINED** | Branch may hold unique history; not removed |
| `F:\projectAi\agent-core-rea-preflight` | `feat/phase-c-rea-preflight` | **RETAINED** | Branch may hold unique history; not removed |

---

## Phase 2 — Backups (verified)

**Location:** `F:\projectAi\REA\backups\agent-core-wip-20261013-consolidation\`

| Artifact | Purpose |
|----------|---------|
| `agent-core-refs.bundle` | SHA256 `8389D7A84CA2BFE867AD025A79416C3662712662255DCD190A184B3B91F1D07B` |
| `git-diff-staged-unstaged.patch` | Pre-merge WIP diff |
| `git-status-porcelain.txt` | Dirty inventory @ `dadbff7` |
| `tracked-mirror/` | Copy of each modified/untracked path |
| `HEAD.sha`, `branches.txt`, `worktrees-porcelain.txt` | Metadata |

**Stash (recovery):** `stash@{0}` — `consolidation-preserve-wip-20261013-1743` (kept until human drops after review)

---

## Phase 3 — Consolidation actions

1. Stashed WIP (including untracked where possible).
2. Merged `feat/jev-rea-local-routing` (`da5cb2b`) → merge commit **`0704443`** on canonical branch.
3. Restored stash; resolved conflicts without force checkout:
   - **Kept PR merge** for `src/knowledge-fabric.ts`, `src/capability-registry.ts`, `docs/V2_PHASE_9_KNOWLEDGE_FABRIC.md` (redaction + REA metadata).
   - **Merged manually** `.env.example` (WIP comments + REA env block), `src/projects.ts` (combined notes).
   - **Tests:** restored WIP assertions on `tests/knowledge-fabric.test.ts`.
4. **PR #24 remote head** unchanged (`da5cb2b`); canonical branch **contains** that commit via merge.
5. No Agent Core source moved into `F:\projectAi\REA` (backups only).

### Post-consolidation working tree (WIP continues)

- Staged/modified: `.env.example`, `schemas/openapi.yaml`, `src/projects.ts`, `tests/knowledge-fabric.test.ts`
- Untracked: `docs/audits/LOCAL_SYNC_RECONCILIATION.md`, `docs/audits/REA_SECURITY_PREFLIGHT.md`
- Merge brought in: `src/rea-local/*`, `/v2/rea/route`, docs, tests (from PR #24)

---

## Phase 4 — QA

| Check | Result |
|-------|--------|
| `npm run build` | **PASS** |
| `npm test` | **PASS** — 104 passed, 1 skipped (live Jev) |
| `user-rea` MCP | **Connected** — tool discovery OK (`binary_session`) |
| Live Jev | **Not run** (no credential in automation env; approval required) |
| Cursor MCP config | **Not modified** |

---

## Phase 5 — Worktree cleanup

- **`agent-core-wt-jev-rea`:** removed via `git worktree remove` when clean (no `--force`).
- **Other worktrees:** retained — not proven redundant or may reference unique branch tips.

---

## Conflicts / blockers

| Item | Status |
|------|--------|
| Stash pop conflicts | **Resolved** (6 files); originals in backup + stash |
| GitHub push/merge PR | **Not done** — separate approval required |
| `feat/jev-rea-local-routing` on GitHub | Still points to `da5cb2b`; canonical has additional merge + WIP |

---

## Rollback

1. Restore from `F:\projectAi\REA\backups\agent-core-wip-20261013-consolidation\tracked-mirror\` or apply stash `stash@{0}`.
2. Reset branch: `git reset --hard dadbff7` (only if merge must be undone — **destructive**; prefer stash/backup).
3. Restore bundle: `git clone agent-core-refs.bundle restored-repo`.

---

## Final gate

**WORKSPACE_CONSOLIDATED** — Jev × REA code and tests live in `F:\projectAi\agent-core`; WIP preserved in backup + stash + partial working tree; QA pass.

**Approval still required:** commit WIP, push branch, merge PR #24, drop stash, optional cleanup of remaining worktrees.
