# Knowledge / Observation — Local Rollback

**Scope:** Local + GitHub only. No VPS steps in this guide.

## Disable client usage

1. Remove `observation` / `memory_store` from `.ai/jev.yaml` `knowledge.default_sources`.
2. Clear `memory_repositories` lists.
3. Stop posting `evidence[]` to `/v2/knowledge/query` from local scripts.

## Revert code

1. Revert merge of the Knowledge/Observation feature PR on `main`.
2. Run `npm test` — expect pre-feature test count.

## Fallback behaviour

- Empty evidence + default sources → OpenWiki handoff only (unchanged).
- Blocked/redacted evidence only → `FALLBACK` / `EVIDENCE_BLOCKED_OR_FILTERED` (safe, no execution).

## Secrets incident

If a token was exported in observation text:

1. Revoke the credential (human).
2. Do not commit the export file.
3. Purge from private memory repo history (human, off-repo).
