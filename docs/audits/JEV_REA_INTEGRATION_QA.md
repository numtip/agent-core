# Jev + REA integration QA

## Automated (CI)

- `tests/jev-rea-local-routing.test.ts` — scenarios A–J (mocked Jev).
- `tests/jev-rea-live.integration.test.ts` — optional live Jev when `LIVE_JEV_REA=1` and `OPENROUTER_API_KEY` set (never logs keys).

## Registry invariant

- `mcp.rea` stays **`PLANNED`** / **`HANDOFF`** in `src/capability-registry.ts` (default export).

## Risk notes

- REA catalog includes tools with write/process/network effects; local allowlist exposes **two** read-class tools only.
- Folder-based “sandbox” is **not** OS isolation; path guard is the control-plane enforcement layer.

## Evidence locations

- Live smoke receipts: `F:\projectAi\REA\out\jev-rea-live-smoke.json` (redacted, local only).
