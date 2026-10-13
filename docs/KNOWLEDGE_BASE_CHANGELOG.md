# Knowledge Base Changelog

Tracks reconciliations between the external index `Agent-Core-Knowledge-Base.md` (workspace `.MD` bundle) and verified repository facts.

## 2026-10-13 — Reality audit reconciliation

**Audit:** [audits/AGENT_CORE_REALITY_AUDIT_20261013.md](audits/AGENT_CORE_REALITY_AUDIT_20261013.md)

| Topic | Previous KB / README implication | Verified fact |
|-------|----------------------------------|---------------|
| Current phase | “Phase 0 — Architecture Foundation” in README | **Stale.** `main` implements V2-9 + PR #19; use IMPLEMENTED/DEPLOYED/ACTIVATED/VERIFIED labels |
| Production version | STATUS: production **0.6.0** @ `4246c0a` | Edge health **2026-10-13:** **0.7.0**; V2-8 QA remains valid for **`4246c0a` only** |
| Memory on GitHub | Implied by integration guides | **No** persistent memory layer in public repo; Hermes / private memory repos are **external** |
| OpenWiki | `/v2/knowledge/query` | **IMPLEMENTED** in code; live transport **not verified** this audit |
| `rae-attendance-v2` | Migration list | **Merged PR #19**; production activation **unknown** |
| REA / observation sync | KB §09–§10 patterns | **Design only** — see `docs/architecture/*` Phase C blueprints |

**Human follow-up:** Update the external `Agent-Core-Knowledge-Base.md` §สถานะปัจจุบัน when this changelog is accepted.
