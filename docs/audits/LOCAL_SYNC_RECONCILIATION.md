# Local Sync & WIP Reconciliation Audit

**Mission:** Agent Core — Local Sync & REA Security Preflight  
**Date:** 2026-10-13 (UTC+7)  
**Repository:** `F:\projectAi\agent-core` · GitHub `numtip/agent-core`  
**Expected `origin/main`:** `c3666b7` (`docs(rea): reconcile local MCP preflight after Knowledge merge (#23)`)

## Scope & constraints

- Local filesystem and read-only GitHub inspection only.
- No merge/rebase of WIP branch, no `reset --hard`, no `git clean`, no force push.
- No VPS, deployment, REA install, or Cursor MCP configuration writes during this mission.

---

## Phase 1 — Local sync (evidence)

### Current HEAD and preservation

| Item | Value | Preserved |
|------|--------|-----------|
| Primary worktree | `F:\projectAi\agent-core` | YES |
| Branch | `docs/reality-reconciliation-20261013` | YES |
| Branch tip (committed) | `dadbff7` | YES (unchanged) |
| Uncommitted WIP | See table below | YES (no destructive git) |
| Local `main` ref | `c3666b7` (= `origin/main`) | YES (updated via ref move, not checkout of WIP) |

### Worktrees (unchanged)

| Path | HEAD / branch |
|------|----------------|
| `F:\projectAi\agent-core` | `dadbff7` · `docs/reality-reconciliation-20261013` |
| `F:\projectAi\agent-core-main-sync` | detached `c3666b7` |
| `F:\projectAi\agent-core-phase-c` | `a468892` · `feat/phase-c-knowledge-observation` |
| `F:\projectAi\agent-core-rea-preflight` | `28de632` · `feat/phase-c-rea-preflight` |
| `F:\projectAi\agent-core-closure-qa` | detached `7268f13` |

### Origin verification

- `git fetch origin` (prior step in mission): **`origin/main` = `c3666b7`** — matches expected SHA.
- Clean QA worktree: **`F:\projectAi\agent-core-main-sync`** at `c3666b7` (no WIP overlay).

### Safe main update method

- **`git branch -f main origin/main`** — local `main` pointer advanced to `c3666b7` without checking out WIP branch or touching dirty files.
- Alternate clean tree **`agent-core-main-sync`** used for `npm test` / `npm run build` because primary tree is dirty.

---

## Phase 2 — WIP reconciliation vs merged PRs

### Merge baseline on `main`

| PR | Theme | Relevant paths (high level) |
|----|--------|-----------------------------|
| **#21** | Knowledge / observation | `src/knowledge-fabric.ts`, `src/knowledge-redaction.ts`, capabilities, `.ai/`, `adapters/agent-core/`, knowledge tests, rollback doc |
| **#23** | REA preflight reconcile | `docs/rea/LOCAL_PREFLIGHT.md`, `mcp.rea` registry metadata, `tests/rea-preflight.test.ts` |

WIP branch **`dadbff7` is behind `main`** and does not include #21/#23 merges in its committed history. Uncommitted edits largely reflect **pre-merge Phase C iterations** and **conflict with current `main`**.

### WIP inventory (primary worktree)

**Modified (tracked):**

- `.env.example`
- `docs/V2_PHASE_9_KNOWLEDGE_FABRIC.md`
- `schemas/openapi.yaml`
- `src/capability-registry.ts`
- `src/cli.ts`
- `src/knowledge-fabric.ts`
- `src/projects.ts`
- `tests/knowledge-fabric.test.ts`
- `tests/project-migration.test.ts`

**Untracked:**

- `.ai/jev.yaml`, `.ai/memory/.gitkeep`, `.ai/policies.yaml`
- `adapters/agent-core/jev.yaml`
- `package-lock.json`
- `tests/agent-core-local-integration.test.ts`

### Classification table

| Path | Class | vs #21 / #23 | Proposed action |
|------|--------|----------------|-----------------|
| `src/knowledge-redaction.ts` | **ALREADY_MERGED** | On `main` (#21); absent from WIP working tree | Do not reintroduce from WIP; use `main` |
| `tests/knowledge-redaction.test.ts` | **ALREADY_MERGED** | On `main` (#21) | Same |
| `docs/rea/LOCAL_PREFLIGHT.md` | **ALREADY_MERGED** | On `main` (#23) | Same |
| `tests/rea-preflight.test.ts` | **ALREADY_MERGED** | On `main` (#23) | Same |
| `docs/operations/KNOWLEDGE_OBSERVATION_ROLLBACK.md` | **ALREADY_MERGED** | On `main` (#21) | Same |
| `.ai/*`, `adapters/agent-core/jev.yaml` (untracked) | **CONFLICT / STALE** | Same paths on `main` but **different file hashes** than WIP copies | After human review: **drop untracked duplicates** or diff-merge intentionally; prefer `main` unless WIP adds unique adapter fields |
| `src/knowledge-fabric.ts` | **CONFLICT** | WIP removes redaction pipeline present on `main` | **Discard WIP hunk**; keep `main` |
| `src/capability-registry.ts` | **CONFLICT** | WIP uncommitted state **diverges** from #23 metadata (`sandbox_root`, `phase`, `vps_execution`, preflight setup hint) | **Discard WIP hunk**; keep `main` |
| `tests/knowledge-fabric.test.ts` | **CONFLICT** | WIP lacks redaction-era expectations | Align to `main` or rewrite in future PR |
| `.env.example`, `schemas/openapi.yaml`, `docs/V2_PHASE_9_KNOWLEDGE_FABRIC.md`, `src/projects.ts` | **CONFLICT / PARTIAL** | Overlap #21 doc/API fields; WIP may be partial | Diff against `main`; port only **net-new** doc/API lines in a **future PR** |
| `src/cli.ts` | **ALREADY_MERGED** (content) | **No diff vs `main`** in current WIP | No action |
| `tests/project-migration.test.ts` | **ALREADY_MERGED** (content) | **No diff vs `main`** | No action |
| `package-lock.json` | **GENERATED** | Not required for mission | **Keep untracked** per instruction; commit only in intentional lockfile PR |
| `tests/agent-core-local-integration.test.ts` | **UNIQUE_WIP** | On `main` under same path but **different content** (WIP: git/REA tool integration; `main`: knowledge HTTP integration) | **Future PR candidate:** merge/rename tests so both scenarios covered without overwriting #21 file blindly |

### Remaining useful functionality (future PR, not this mission)

1. **Tool-route integration tests** from WIP `tests/agent-core-local-integration.test.ts` (git + `mcp.rea` discovery) — add as **separate file** or extend suite without reverting knowledge tests on `main`.
2. **Doc deltas** in `V2_PHASE_9_KNOWLEDGE_FABRIC.md` — only if they add facts not already on `main`.
3. **Branch `docs/reality-reconciliation-20261013` @ `dadbff7`** — may still carry audit-only commits; reconcile with `main` via **new PR** after human chooses merge vs close branch (no auto-merge here).

### Explicit non-actions

- Did **not** delete WIP, `package-lock.json`, or any worktree.
- Did **not** merge/rebase `docs/reality-reconciliation-20261013` onto `main`.

---

## Phase 4 — Contract QA (local)

Executed in **`F:\projectAi\agent-core-main-sync`** @ `c3666b7`:

| Check | Result |
|-------|--------|
| `npm test` | **PASS** — 93 tests, 20 files |
| `npm run build` | **PASS** (`tsc`) |
| `mcp.rea` status | **PLANNED**, `execution_mode: HANDOFF`, `control_plane_execution: false` |
| PLANNED execute guard | **PASS** — `tests/rea-preflight.test.ts` (`UNAVAILABLE` / `CAPABILITY_NOT_ACTIVE`) |
| REA MCP installed/activated this mission | **NO** |

---

## Checklist summary

| Gate | Status |
|------|--------|
| `origin/main` = `c3666b7` | **PASS** |
| WIP + branch `dadbff7` preserved | **PASS** |
| Local `main` ref updated safely | **PASS** |
| WIP classified vs #21/#23 | **PASS** |
| Clean-tree QA | **PASS** |
| Git push / merge WIP | **STOP** (human) |

---

## Human approval gates (remaining)

1. Decide fate of **stale uncommitted WIP** (stash, discard file-by-file, or cherry-pick onto new branch from `main`).
2. **Future PR** for unique integration tests and any doc deltas.
3. **No push** until explicitly requested.
