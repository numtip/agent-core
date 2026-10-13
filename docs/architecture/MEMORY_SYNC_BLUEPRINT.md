# Memory / Observation Sync Blueprint (Phase C — design only)

**Status:** DESIGN / PREFLIGHT — **no sync jobs, no private repos created**  
**API anchor:** `POST /v2/knowledge/query` (CONTEXT_ONLY authority)

## Problem

Agent Core routes decisions; **persistent observation** lives outside the runtime (Claude-Mem exports, Hermes, `.ai/memory/`). Sync must be **selective**, **provable**, and **non-authoritative**.

## Layers

| Layer | Store | Authority |
|-------|-------|-----------|
| Explicit state | `.ai/state/`, task JSON | Resumable work truth (project-local) |
| Hermes native | `HERMES_HOME` | Session + durable agent/user memory (local) |
| Observation export | Private GitHub repo | Filtered snapshots only |
| Agent Core context | `/v2/knowledge/query` evidence | Governed read; **never** execution auth |

## Sync flow (end-of-day, non-real-time)

```text
Work session
    → collect observations / decisions (audit export)
    → filter (rules + optional Jev) importance ≥ threshold
    → redact secrets / tokens / PII patterns
    → write to private memory repo OR .ai/memory/snapshots/
    → optional: POST evidence[] to /v2/knowledge/query → CONTEXT_READY
```

## Evidence schema (minimum)

- `id`, `text`, `kind` (`observation` | `memory` | `knowledge`)
- `repository`, `revision`, `path`, `source_url` when from Git
- `importance` (0–1), `filtered: true`, optional `observed_at`, `session_id`
- **Never** commit raw transcripts or credentials to public `numtip/agent-core`

## Provenance & retention

- Retain 90 days hot in private repo; archive older with compressed JSONL.
- Deduplicate by `(repository, path, content_hash)`.
- `<private>` tag in text → drop at export gate.

## Security

| Risk | Control |
|------|---------|
| Public leak | Private GH repo; pre-push secret scan |
| Stale memory overrides code | `verify_source_of_truth_before_execution` guardrail |
| Over-sync noise | `importance_min` default 0.6; Context Governor compression |

## Activation gates (human)

1. Create private `numtip/agent-core-memory` (or org equivalent).
2. Set `memory_repositories` in project `.ai/jev.yaml`.
3. Live QA: handoff → client fetch → evidence round-trip → spot-check redaction.

## Rollback

Stop scheduled export; clear `memory_repositories`; knowledge API still works with OpenWiki-only default.
