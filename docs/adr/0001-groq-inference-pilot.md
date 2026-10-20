# ADR 0001: Optional Groq inference pilot (dev-only)

**Status:** Accepted (pilot) · **VPS:** BLOCKED  
**Date:** 2026-10-21  
**Branch:** `feat/groq-inference-pilot`

## Context

Agent Core must keep **Jev Decisions on OpenRouter** (`/v1/decision`, `/v1/route`, `/v1/qa`). We need optional, bounded **chat inference** for local pilot work (`openai/gpt-oss-120b` on Groq) without production activation.

## Decision

1. Add `/v2/inference/complete` and `/v2/inference/budget` behind scope **`inference`**.
2. **Pilot activation:** `development` and `test` only; **`production` always BLOCKED** (`GROQ_PILOT_ACTIVATION=dev-only|blocked`).
3. **Budget:** monthly USD cap with ledger file; atomic writes; fail-closed on corrupt JSON; month rollover archives prior file (no silent spend reset). Pre-dispatch reserve uses a conservative prompt estimate and a hard completion-token cap. If provider usage still exceeds the cap, settlement **records the actual cost**, sets `overspend_blocked`, and refuses later requests. In-process + O_EXCL file lock with stale-lock reclaim (**not** multi-instance safe on VPS).
4. **Cost:** `estimated_cost_usd` from **provider-reported token usage** × configurable rates — **not** Groq/OpenRouter invoices.
5. **Resilience:** timeout, retry on 429/5xx, optional OpenRouter chat fallback with **separate pricing rates**.
6. **Reservations:** reserve before upstream call, settle or release on success/failure.

## Consequences

- Safe local/dev experimentation under $10/month guard (configurable).
- **NO-GO for VPS** until distributed budget store or billing API integration exists.
- Hermes read-only pilot can consume inference as CONTEXT-only handoff (see `docs/pilots/HERMES_READONLY_INFERENCE_PILOT.md`).

## Alternatives rejected

- Replacing Jev with Groq for decisions (breaks v1/v2 decision contract).
- Shared ledger without locking (race overspend).
- Production enable via env flag alone (explicit pilot guard required).
