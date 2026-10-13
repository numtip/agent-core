# V2-9 — Knowledge Fabric / OpenWiki Integration

## Goal

Add a read-only knowledge layer beneath the Context Governor without making a wiki an execution authority.

```text
Projects / Agents
      |
      v
Agent Core
      |
      v
Knowledge Fabric
      |
      v
OpenWiki (read-only evidence)
      |
      v
Context Governor
      |
      v
Reasoning / execution
```

## Locked invariants

1. OpenWiki is a knowledge source, never an authorization source.
2. Knowledge access is READ-only in V2-9.
3. Hard Policy remains authoritative.
4. Returned wiki evidence is passed through Context Governor before use.
5. Source provenance is preserved where available.
6. Agents must verify source-of-truth state before writes, production actions, or irreversible work.
7. No OpenWiki secret is stored by Agent Core in this phase.

## Capabilities

| ID | Status (repo) | Notes |
|----|---------------|-------|
| `knowledge.openwiki` | IMPLEMENTED | OpenWiki MCP handoff |
| `knowledge.observation` | IMPLEMENTED | Client fetch from private GH export |
| `knowledge.memory-store` | IMPLEMENTED | `.ai/memory/` + Hermes export handoff |

Shared: READ-only · HANDOFF · CONTEXT_ONLY · deterministic redaction before `CONTEXT_READY`

**ACTIVATED:** OpenWiki transport, scheduled sync, and private memory repos remain human-gated.

## API

`POST /v2/knowledge/query`

The endpoint uses the existing `context` project scope.

With no evidence supplied, Agent Core returns handoffs for requested `sources` (default `openwiki`).

When evidence is supplied, entries marked private are dropped, secret-like patterns are redacted, then Context Governor returns `CONTEXT_READY`. All-blocked evidence → `FALLBACK` (`EVIDENCE_BLOCKED_OR_FILTERED`).

## Pilot

Initial recommended linked workspace:

- `numtip/agent-core`
- `numtip/goffice2026`

After runtime QA, expand to:

- `52clips`
- `handbook`
- `attendance-report-generator`
- `dbplant`

## Runtime activation gate

Repository implementation does not prove a live OpenWiki transport. Live activation should verify:

- OpenWiki installed/configured on the execution environment
- linked workspace for pilot repositories
- coding-agent/MCP integration reachable
- no credentials in Git
- evidence includes usable repository/path/revision provenance
- stale knowledge never overrides live repository or production state

## Suggested benchmark

Measure:

- context token/character reduction
- retrieval precision
- stale-context rate
- time-to-task
- task success rate
- provenance coverage

V2-9 should remain reversible: disabling the OpenWiki adapter must fall back to normal repository/context retrieval without weakening policy.
