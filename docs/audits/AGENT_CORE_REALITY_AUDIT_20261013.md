# Agent Core — Reality Audit (2026-10-13)

**Auditor role:** Lead Engineering Agent (READ-ONLY production; no mutations)  
**Repository:** `numtip/agent-core`  
**Audit window:** 2026-10-13 (UTC+7)  

## Executive summary

| Item | Value |
|------|--------|
| **Source `origin/main` SHA** | `dbe20a5543c07996aafc9f39ceb050007ce79842` |
| **Local `HEAD`** | Same as `origin/main` (clean tracking) |
| **Package version (source)** | `0.7.0` |
| **Documented production release (STATUS.md)** | `4246c0a` · runtime **0.6.0** |
| **Edge health (NEW, this audit)** | `https://agent.raemanagemju.net/v1/health` → **`version: 0.7.0`** |
| **SSH VPS audit (`10.1.254.237`)** | **BLOCKED** (connection timeout from audit environment) |
| **Gate B** | **PASS WITH DOCUMENTED DRIFT** — docs lag live version; SSH prevents SHA-level production confirmation |

Production was **not** modified during this audit.

---

## 1. GitHub / source (VERIFIED)

| Check | Status | Evidence |
|-------|--------|----------|
| Remote | VERIFIED | `origin` → `https://github.com/numtip/agent-core.git` |
| Branch | VERIFIED | `main` tracks `origin/main` |
| HEAD | VERIFIED | `dbe20a5` — merge PR #19 |
| Open PRs | VERIFIED | PR #4 `ops/production-activation` (OPEN, stale lineage per STATUS.md W8) |
| Recent CI | VERIFIED | Push `dbe20a5` → workflow `CI` **success** (~38s), run id `38209632353` |
| Tags | VERIFIED | None listed locally (release-by-SHA layout on VPS per activation report) |

### Commits after documented deploy `4246c0a`

```
dbe20a5 feat(projects): onboard rae-attendance-v2 + fail-closed scope resolution (RB-1) (#19)
01092e2 feat(v2): add V2-9 Knowledge Fabric with OpenWiki contracts
61f6d16 Merge pull request #17 from numtip/ops/v2-final-evidence
ebdb06d docs(v2): pin V2-8 evidence to the deployed release 4246c0a
```

**Interpretation:** Source is **ahead** of the SHA pinned in V2-8 activation docs. V2-9 Knowledge Fabric and `rae-attendance-v2` onboarding are **on `main`**, not merely planned.

---

## 2. Version discrepancy resolution

| Claim | Finding | Classification |
|-------|---------|----------------|
| Source v0.7.0 | Matches `package.json` on `main` | VERIFIED |
| STATUS.md production v0.6.0 @ `4246c0a` | Accurate for **2026-09-25 activation** evidence | DOCUMENTED_ONLY (historical) |
| Previous ops report production v0.7.0 | **Consistent with NEW edge health** (this audit) | VERIFIED (partial — health JSON only) |
| Deployed tree SHA on VPS | Unknown without SSH or authenticated deploy API | UNKNOWN |

**Conclusion:** Runtime **version string** on the public edge is **0.7.0** (new check). Written status still describes **0.6.0 @ 4246c0a** — **documentation drift**, not necessarily unauthorized drift. Exact release directory symlink requires VPS access.

---

## 3. PR #19 / `rae-attendance-v2` (VERIFIED source · UNKNOWN production)

| Item | Status |
|------|--------|
| PR #19 merged | VERIFIED — `2026-10-12`, commit `dbe20a5` |
| Adapter `adapters/rae-attendance-v2/jev.yaml` | VERIFIED in source |
| Registry profile `src/projects.ts` | VERIFIED — default scope `["decision"]` only |
| Tests | VERIFIED — `tests/rae-attendance-v2-onboarding.test.ts` in CI |
| Production machine identity / scopes | UNKNOWN — V2-8 report lists **5** project keys; no live proof `rae-attendance-v2` token exists on host |
| Production activation | **NOT VERIFIED** — treat as **IMPLEMENTED, not ACTIVATED** |

---

## 4. VPS / runtime (BLOCKED + edge partial)

| Check | Status | Notes |
|-------|--------|-------|
| SSH `ubantu24@10.1.254.237` | BLOCKED | Timeout; no bypass attempted |
| Loopback bind / service state | UNKNOWN | Per last activation report: `127.0.0.1:8787` |
| Edge `/v1/health` | VERIFIED | `status: ok`, `auth_required: true`, `api_versions: [v1,v2]`, **`version: 0.7.0`** |
| Scope / adapter enforcement live | UNKNOWN | Requires project tokens; not executed (no synthetic auth) |
| Browser MCP / kill switch | DOCUMENTED_ONLY | Last live evidence V2-8 @ `4246c0a` |
| Jev / OpenRouter | DOCUMENTED_ONLY | `provider_configured: true` on health only |

---

## 5. Knowledge Fabric / V2-9

| Item | Status |
|------|--------|
| `/v2/knowledge/query` on `main` | VERIFIED (source + unit tests on `main`) |
| OpenWiki live transport | ACTIVATION-GATED per `docs/V2_PHASE_9_KNOWLEDGE_FABRIC.md` |
| Observation / memory-store extensions | **WORKTREE_LOCAL ONLY** — not on `origin/main` at audit time |

---

## 6. Local worktree (not on GitHub)

Uncommitted changes present on auditor machine (integration WIP): `.ai/`, `adapters/agent-core/`, knowledge-fabric extensions, `package-lock.json`, etc. **Do not treat as published source.**

---

## 7. QA evidence classification

| Evidence set | SHA / date | Relation to production |
|--------------|------------|-------------------------|
| V2-8 live QA / benchmark | `4246c0a` · 2026-09-25 | Historical · **VERIFIED** for that release |
| CI on `dbe20a5` | 2026-10-12 | Source-only · **VERIFIED** |
| Local vitest (auditor) | Dirty worktree · 2026-10-13 | **90/90 PASS** · not a production claim |

---

## 8. Security / policy (no weakening)

| Area | Finding | Severity |
|------|---------|----------|
| Auth on health-adjacent routes | Health unauthenticated; API requires project auth per design | INFO |
| `/v2/*` Cloudflare Access gap | DOCUMENTED_ONLY (STATUS W7) | MEDIUM (documented) |
| SSRF / browser guards | DOCUMENTED_ONLY in V2-8 adversarial QA | LOW–MEDIUM |
| Secret exposure in audit | None | — |

No critical security regression identified from available evidence. SSH gap prevents confirming config drift on host.

---

## 9. Gaps and recommendations

1. **Reconcile `docs/STATUS.md`** with edge health `0.7.0` and post-`4246c0a` SHAs (Phase A).
2. **VPS read-only re-audit** when SSH/tunnel available: `readlink ~/agent-core/current`, health loopback, project key count, `rae-attendance-v2` presence.
3. **`rae-attendance-v2` activation:** human-approved deploy + scoped token; verify least-privilege (`decision` only) live.
4. **V2-9 activation QA** before claiming OpenWiki or observation memory live.
5. **Add root `AGENTS.md`** — missing; bootstrap rules currently scattered (`docs/PROJECT_INTEGRATION.md`, activation reports).
6. **Commit `package-lock.json`** on `main` when approved — reproducibility (STATUS W1).

---

## 10. Gate B decision

**PASS WITH DOCUMENTED DRIFT** — Proceed to Phase A (documentation). Do **not** deploy or push without human approval. Exact production SHA remains **UNKNOWN** until VPS access is restored.
