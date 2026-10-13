# REA Local Integration Blueprint (Phase C — design only)

**Status:** DESIGN / PREFLIGHT — **not activated**  
**Default execution surface:** Cursor local MCP · sandbox root `F:\projectAi\REA\`  
**Control plane:** Agent Core remains router/policy; **no default VPS execution**

## Goals

- Register REA as a **HANDOFF** capability (`mcp.rea`, status PLANNED → ACTIVE when client ready).
- Route via `TOOL_ROUTE` / `/v2/route` / `/v2/execute` with progressive disclosure.
- Keep reverse-engineering workloads off the production VPS unless explicitly approved.

## Architecture

```text
Cursor Agent
     |  MCP (local)
     v
 REA runtime  (F:\projectAi\REA\)
     ^
     |  HANDOFF contract
Agent Core /v2/execute  (policy + scope)
```

## Contracts

| Field | Rule |
|-------|------|
| `capability_id` | `mcp.rea` |
| `operations` | `READ`, `EXTERNAL` |
| `risk` | HIGH |
| `execution_mode` | HANDOFF |
| `transport` | MCP (`npx rea-agents setup` on developer machine) |
| Scope | Project token must include `route`; REA never receives OpenRouter/Jev secrets |

## Policy gates

- **DESTRUCTIVE / EXTERNAL** → human approval or explicit scope.
- REA output is **context**, not authorization — verify in repo before writes.
- Sandbox: prefer read-only mounts; no production DB/network from REA host without approval.

## Threat model (summary)

| Threat | Mitigation |
|--------|------------|
| Malware in analyzed binaries | Local VM/sandbox; no auto-upload to VPS |
| Secret exfil via REA reports | Redaction pipeline before memory sync |
| REA on VPS | Denied by default; separate approval track |

## Fallback

If REA unavailable → route to `agent.cursor` / human; Jev failure must not block project (existing invariant).

## QA (pre-activation)

- Capability search returns `mcp.rea` with `include_planned: true`.
- `/v2/execute` returns HANDOFF, `executed: false`.
- Cursor MCP smoke (local only) — **not run in Phase C**.

## Rollback

Disable MCP config in Cursor; set capability `DISABLED` in registry; no VPS change required.
