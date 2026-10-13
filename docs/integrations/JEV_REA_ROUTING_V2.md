# Jev × REA local routing — profile v2

**Status:** `C_ROUTING_V2_READY` (pending PR review; not merged)  
**Base:** `main` @ `93a4a36`  
**Registry:** `mcp.rea` remains **PLANNED / HANDOFF** — Cursor executes `user-rea` tools only.

## Profiles

| Profile | Env | Allowlisted tools |
|---------|-----|-------------------|
| **v1** (default) | `REA_ALLOWLIST_PROFILE=v1` | `binary_session`, `analyze_javascript_application` (synthetic inbox only) |
| **v2** | `REA_ALLOWLIST_PROFILE=v2` | v1 + `trace_web_module_imports`, `trace_web_source_location` (workspace-bounded manifest/map paths) |

All other REA MCP catalog tools stay **denied** at `/v2/rea/route`.

## Flow (unchanged)

1. Fail-closed config gates (`REA_LOCAL_HANDOFF_ENABLED`, roots, profile).
2. Injection scan → `HUMAN_REVIEW` when detected.
3. Deterministic eligibility → Jev `TOOL_ROUTE` among eligible allowlist entries only.
4. Re-validate Jev choice against active profile allowlist.
5. Zod args + path canonicalization (`none` / `workspace` / `synthetic`).
6. Hard policy on filesystem targets.
7. Side effects (`PROCESS`, `NETWORK`, `WRITE`, `DESTRUCTIVE`) → `HUMAN_REVIEW` before handoff.
8. Confidence policy → `ALLOW_HANDOFF` only on Jev `EXECUTE`.

## v2 tool notes

- **trace_web_module_imports** — requires `manifest_path` under `REA_WORKSPACE_ROOTS`; optional `import_map.path` also workspace-bounded. Declared `PROCESS` → human review at route layer even when Jev confidence is high.
- **trace_web_source_location** — same for `manifest_path` and `source_map.path`.

## Rollback

Set `REA_ALLOWLIST_PROFILE=v1` (or unset) and restart Agent Core. No registry promotion required.

See [REA tool classification](../audits/REA_TOOL_RISK_CLASSIFICATION.md) on the docs PR branch for full catalog metadata.
