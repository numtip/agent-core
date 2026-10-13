# Jev × REA routing v2 — QA record

**Branch:** `feat/jev-rea-routing-v2`  
**Base SHA:** `93a4a361b115da15d146b4fe4d927b1f51324a68`

## Automated gates

| Gate | Command | Expected |
|------|---------|----------|
| Install | `npm ci` | clean lockfile |
| Build | `npm run build` | `tsc` success |
| Tests | `npm test` | all unit tests green; live Jev test skipped unless `LIVE_JEV_REA=1` |
| Secret scan | `git grep -iE 'sk-or-|OPENROUTER_API_KEY='` on diff | no committed secrets |

## Test focus

- `tests/jev-rea-local-routing.test.ts` — v1 regression matrix (A–J).
- `tests/jev-rea-routing-v2.test.ts` — profile gating, workspace paths, side-effect review for v2 tools.
- `tests/rea-preflight.test.ts` — `mcp.rea` PLANNED / gateway UNAVAILABLE.

## Optional live smoke

```text
LIVE_JEV_REA=1 node --env-file=.env npm test -- tests/jev-rea-live.integration.test.ts
```

Requires local `.env` (gitignored). Never log `OPENROUTER_API_KEY`.

## Evidence (local, not in git)

Prior v1 live correlation: `F:\projectAi\REA\out\jev-rea-live-correlated.json`.
