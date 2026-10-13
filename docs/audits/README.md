# Agent Core audit index

Historical audits retain **original dates and SHAs**; do not rewrite point-in-time claims.

| Document | Type | Notes |
|----------|------|--------|
| [WIP_RECONCILIATION_FINAL.md](./WIP_RECONCILIATION_FINAL.md) | **Canonical WIP narrative** | Current disposition vs `main` @ `93a4a36` |
| [JEV_REA_GITHUB_CLOSEOUT.md](./JEV_REA_GITHUB_CLOSEOUT.md) | Closeout | PR #24 merge, CI, security |
| [WORKSPACE_CONSOLIDATION.md](./WORKSPACE_CONSOLIDATION.md) | Evidence | Local worktree consolidation |
| [LOCAL_SYNC_RECONCILIATION.md](./LOCAL_SYNC_RECONCILIATION.md) | Evidence | WIP vs merged PRs #21/#23 |
| [REA_SECURITY_PREFLIGHT.md](./REA_SECURITY_PREFLIGHT.md) | Evidence | **Pre-install snapshot** (before REA MCP activation) |
| [REA_TOOL_RISK_CLASSIFICATION.md](./REA_TOOL_RISK_CLASSIFICATION.md) | Classification | REA MCP catalog via `binary_session` metadata |
| [AGENT_CORE_REALITY_AUDIT_20261013.md](./AGENT_CORE_REALITY_AUDIT_20261013.md) | Reality audit | On `main`; Gate B drift |
| [REVERSE_SKILL_GAP_AUDIT_20261013.md](./REVERSE_SKILL_GAP_AUDIT_20261013.md) | Gap audit | reverse-skill `1.0.1` @ `cab634bd`; **0 adopted**; runtime unchanged |
| [JEV_REA_INTEGRATION_QA.md](./JEV_REA_INTEGRATION_QA.md) | QA index | On `main` |

**REA workspace operational truth:** `F:\projectAi\REA\PREFLIGHT_STATUS.md`, `README.md`, `out/*.json` (local only).

**Integration how-to:** [../integrations/JEV_REA_LOCAL_INTEGRATION.md](../integrations/JEV_REA_LOCAL_INTEGRATION.md)

**Session memory:** [../memory/README.md](../memory/README.md) · EOD 2026-10-13 → `main` @ `8e77ab5`
