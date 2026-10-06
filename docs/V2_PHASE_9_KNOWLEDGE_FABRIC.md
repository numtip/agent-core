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

## Capability

`knowledge.openwiki`

- kind: MCP
- operation: READ only
- risk: LOW
- execution mode: HANDOFF
- authority: CONTEXT_ONLY
- transport: OpenWiki MCP / coding-agent integration

## API

`POST /v2/knowledge/query`

The endpoint uses the existing `context` project scope.

With no evidence supplied, Agent Core returns a policy-checked OpenWiki handoff contract.

When OpenWiki evidence is supplied by an authorized adapter/client, Agent Core normalizes provenance and passes the content through Context Governor before returning `CONTEXT_READY`.

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
