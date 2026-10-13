# Phase C Implementation Plan (REA + Memory)

**Prerequisite:** Phase B audit + Phase A doc reconciliation merged (human approval for push).  
**This document:** ordered work **after** explicit human go-ahead per gate.

## Stage C1 — Registry & docs (repo only)

- [ ] Set `mcp.rea` to ACTIVE or keep PLANNED with handoff tests
- [ ] Merge observation/memory capability docs with OpenAPI if API fields added
- [ ] Add adapter notes under `adapters/agent-core/jev.yaml` (`memory_repositories`)

**Approval:** PR review · no production

## Stage C2 — REA local sandbox

- [ ] Create `F:\projectAi\REA\` layout (isolated from agent-core runtime)
- [ ] Cursor MCP entry (user machine) — **human installs** `npx rea-agents setup`
- [ ] Verify `/v2/execute` HANDOFF for `mcp.rea`

**Approval:** User confirms MCP config

## Stage C3 — Memory private repo

- [ ] Create private GitHub memory repo
- [ ] Define export schema (JSONL) + redaction script in repo or ops (no secrets in git)
- [ ] Document snapshot path `.ai/memory/` (gitignored state)

**Approval:** Repo visibility + org policy

## Stage C4 — Production knowledge (optional)

- [ ] OpenWiki MCP activation QA on VPS or client handoff only
- [ ] Re-run live QA subset for `/v2/knowledge/query` through edge
- [ ] Update STATUS IMPLEMENTED → ACTIVATED → VERIFIED with SHA

**Approval:** Production deploy + credentials

## Stage C5 — `rae-attendance-v2` production identity

- [ ] Add scoped token on VPS env (decision-only)
- [ ] Verify fail-closed routes (403 without scope)
- [ ] Record in activation report

**Approval:** VPS env change

## Non-goals (Phase C)

- No REA on VPS by default
- No automatic Git push from agents
- No weakening Cloudflare Access / scope model

## Success metrics

- HANDOFF contracts documented and tested locally
- Zero secrets in public GitHub
- Memory sync dry-run with redaction log reviewed by human
