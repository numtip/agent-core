# REA Local Preflight (do not install until complete)

**Sandbox root:** `F:\projectAi\REA`  
**Execution:** Cursor MCP on developer machine only  
**Agent Core:** routing HANDOFF via `mcp.rea` — no VPS execution

## Checklist (human)

- [ ] Sandbox directory exists and is outside production repos
- [ ] Windows Defender / AV policy reviewed for analyzed binaries
- [ ] Cursor MCP config changes reviewed before save
- [ ] No OpenRouter/Jev/production tokens in REA workspace
- [ ] Outputs redacted before any memory sync
- [ ] Rollback: disable MCP + set `mcp.rea` capability DISABLED in registry

## Filesystem boundaries

| Allowed | Blocked |
|---------|---------|
| `F:\projectAi\REA\inbox\` drop samples | Production VPS paths |
| `F:\projectAi\REA\out\` reports | `.env`, SSH keys, `~/.config/agent-core` |
| Read-only reference copies | Auto-upload to public GitHub |

## MCP inspection (before `npx rea-agents setup`)

1. Record intended MCP server command and cwd (no secrets in notes committed to public repo).
2. Confirm REA runs as current user, not elevated admin unless required.
3. Verify Agent Core `/v2/execute` returns `HANDOFF` for `capability_id: mcp.rea`.

## Installation gate

**STOP** until all checklist items pass and a human approves install.
