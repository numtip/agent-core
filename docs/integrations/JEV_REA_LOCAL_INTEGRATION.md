# Jev → REA local integration (Cursor MCP)

**Status:** Local-only handoff routing in Agent Core. **`mcp.rea` remains `PLANNED`** in the default capability registry; production/shared runtime is unchanged.

## Flow

1. Client reports `rea_mcp_connected` (Cursor `user-rea` namespace).
2. **Deterministic allowlist** filters REA tool IDs (`binary_session`, `analyze_javascript_application`).
3. **Path guard** canonicalizes Windows paths, blocks traversal/UNC, resolves symlinks via `realpath`, enforces `inbox/synthetic-app` for JS analysis.
4. **Jev** (`decision_type: TOOL_ROUTE`) ranks only allowlisted options.
5. **Hard policy** (`evaluateHardPolicy`, prompt-injection guard) runs **after** Jev; confidence is never authorization.
6. Response disposition: `ALLOW_HANDOFF` | `HUMAN_REVIEW` | `DENY` | `FALLBACK` | `UNAVAILABLE`.
7. **Cursor** executes `handoff.tool` via MCP (`user-rea`); Agent Core does not proxy REA.

## API

`POST /v2/rea/route` (scope: `route`)

```json
{
  "project": "agent-core",
  "task_id": "rea-001",
  "task": "Analyze synthetic JavaScript sample",
  "tool_arguments": {
    "input_path": "F:\\projectAi\\REA\\inbox\\synthetic-app",
    "format": "directory",
    "detail": "summary"
  },
  "rea_mcp_connected": true
}
```

## Configuration (fail-closed)

| Variable | Default | Purpose |
|----------|---------|---------|
| `REA_LOCAL_HANDOFF_ENABLED` | `false` | Local-only override gate |
| `REA_WORKSPACE_ROOTS` | `[]` | JSON array of allowed absolute roots |
| `REA_PACKAGE_VERSION` | `6.4.0` | Receipt metadata |

## Rollback

Set `REA_LOCAL_HANDOFF_ENABLED=false` and reload Agent Core. Remove `/v2/rea/route` callers. Cursor MCP registrations unchanged.
