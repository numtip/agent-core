# Groq pilot QA evidence — 2026-10-21

**Branch:** `feat/groq-inference-pilot`  
**Baseline HEAD (pre-commit):** `93afa3e`  
**Labels:** IMPLEMENTED (branch) · VERIFIED (local tests) · DEPLOYED **No** · VPS **BLOCKED**

## Automated tests (exact)

```bash
npm run build
npm test
```

| Suite | Focus |
|-------|--------|
| `tests/groq-inference.test.ts` | Scope auth, ledger write, fallback, budget reject |
| `tests/groq-inference-hardening.test.ts` | Auth 401/403, production block, 429 retry, pricing split, concurrency, HTTP 402, HTTP 503 pilot/corrupt ledger/ambiguous usage |
| `tests/knowledge-redaction.test.ts` | `gsk_` pattern redaction |
| `tests/ledger-budget-safety.test.ts` | Corrupt ledger fail-closed, month archive, stale lock, cross-process reserve deny, fallback shared budget, ambiguous usage reject |
| Full regression | All other vitest files |

Live (optional, gated):

```bash
LIVE_GROQ_INFERENCE=1 GROQ_ENABLED=true node --env-file=.env npm test -- tests/groq-inference.live.integration.test.ts
node --env-file=.env ops/groq-benchmark.mjs   # 3 tasks when server running
```

## Cost verification

- Response fields: `usage.*` from provider JSON; `estimated_cost_usd` = heuristic rates (`GROQ_USD_PER_1M_*`, `OPENROUTER_USD_PER_1M_*`).
- `cost_basis`: always `estimate_from_provider_usage` — **not actual billing**.
- Benchmark reference (prior session): ~$0.00027 ledger spend for 4 requests / 735 tokens (local Groq).

## Secret safety

- No keys in git; `.env` gitignored; audit logs token counts only.
- `knowledge-redaction` includes `gsk_` pattern.

## Hermes pilot readiness

Checklist: `docs/pilots/HERMES_READONLY_INFERENCE_PILOT.md` — **READY for read-only pilot** once Draft PR merged locally; **not** production Hermes VPS workflows.

## Remaining risks

| Risk | Mitigation |
|------|------------|
| Multi-process ledger races | DEV-only; VPS BLOCKED; file lock best-effort |
| Rate table drift vs Groq invoice | Operator updates env rates; document estimate-only |
| `gpt-oss-120b` reasoning field | Parser maps `reasoning` when `content` empty |

## GO / NO-GO

| Gate | Verdict |
|------|---------|
| **Draft PR** (local branch) | **GO** after commit on `feat/groq-inference-pilot` |
| **Hermes read-only pilot** | **GO** (dev workstation, read-only MCP + inference scope) |
| **VPS / production activation** | **NO-GO** |
