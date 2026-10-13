# REA Security Preflight Audit

**Mission:** Agent Core — Local Sync & REA Security Preflight  
**Date:** 2026-10-13 (UTC+7)  
**Sandbox root:** `F:\projectAi\REA`  
**Agent Core contract reference:** `main` @ `c3666b7`  
**Docs read:** `docs/rea/LOCAL_PREFLIGHT.md`, `docs/architecture/REA_LOCAL_INTEGRATION_BLUEPRINT.md`, `docs/architecture/PHASE_C_IMPLEMENTATION_PLAN.md`

## Executive summary

Filesystem layout for REA is **in place** and **not nested inside** the `agent-core` git repository. **No OS-level sandbox isolation** is enforced by that layout alone: it is a **convention boundary**, not a security boundary. REA MCP is **not installed**; Cursor user MCP config **does not list REA**. Agent Core keeps **`mcp.rea` PLANNED / HANDOFF** with tests blocking control-plane execution. **STOP** remains in effect before `npx rea-agents setup`, Cursor MCP edits, private memory repo creation, or production work.

---

## Phase 3 — Sandbox layout

| Path | Status |
|------|--------|
| `F:\projectAi\REA\inbox\` | **EXISTS** |
| `F:\projectAi\REA\out\` | **EXISTS** |
| `F:\projectAi\REA\quarantine\` | **EXISTS** |
| `README.md`, `.gitignore`, `PREFLIGHT_STATUS.md` | Present |

`PREFLIGHT_STATUS.md` states: MCP installed **NO**, Cursor MCP configured **NO**, production **NO**.

### Nesting vs production repo

- `F:\projectAi\REA` and `F:\projectAi\agent-core` are **sibling paths** under `F:\projectAi\`.
- **PASS:** REA sandbox is **not** nested under the agent-core git worktree.

---

## Filesystem permissions & isolation reality

**Sample ACL (top of `F:\projectAi\REA`):**

- `BUILTIN\Administrators`, `NT AUTHORITY\SYSTEM` — full control (inherited).
- `NT AUTHORITY\Authenticated Users` — modify (inherited).
- `BUILTIN\Users` — read/execute (inherited).

**Assessment:**

| Claim | Verdict |
|-------|---------|
| Dedicated folder for samples/reports | **PASS** (organization) |
| Prevents other users/processes on same Windows profile from reading/writing REA | **UNKNOWN / NO** — standard user ACLs |
| VM, AppContainer, WSL2 boundary, mandatory integrity level | **NOT ENFORCED** |
| REA process confined to inbox/out only | **NOT ENFORCED** (policy only until MCP runs) |

**Critical distinction:** A folder alone is **not** a sandbox. **Human gate:** use VM or hardened analysis host for untrusted binaries even with Defender enabled.

---

## Windows Defender / AV (non-mutating)

| Signal | Observed |
|--------|----------|
| AMServiceEnabled | **True** |
| AntispywareEnabled | **True** |
| RealTimeProtectionEnabled | **True** |
| IoavProtectionEnabled | **True** |
| NISEnabled | **True** |

**PASS** for baseline real-time protection on this workstation. **UNKNOWN:** exclusions, controlled folder access, and corporate AV overrides (not enumerated destructively).

---

## Credential & secret surface (REA tree)

- Filename/signature scan under `F:\projectAi\REA` for patterns (`env`, `key`, `pem`, `secret`, `token`, `credential`, `password`, `id_rsa`): **no matches**.
- **PASS** (no obvious credential files in sandbox). **Limitation:** content not scanned; only names.

---

## Cursor MCP inspection (names & executables only)

User config present: `C:\Users\prinya\.cursor\mcp.json` (values redacted in this report).

| MCP server name | Command (summary) |
|-----------------|-------------------|
| `magnific` | (entry present; command not expanded here) |
| `hermes-memory` | Python under `F:\projectAi\ai-operating-system\.runtime\hermes-agent\.venv\Scripts\` |
| `hermes-tools` | Same venv · Hermes transport module |

- **REA / `rea-agents`:** **NOT LISTED** — **PASS** (not configured).
- Project-level `F:\projectAi\agent-core\.cursor\mcp.json`: **not present**.
- **No MCP configuration writes** during this mission.

---

## REA upstream (read-only metadata)

- Package: **`rea-agents`** (npm registry read).
- Description: reverse-engineering CLI + MCP server.
- Homepage: `https://github.com/morluto/rea#readme`
- Binaries: `rea`, `rea-agents` → `scripts/rea.mjs`
- Documented setup path: **`npx rea-agents setup`** (per repo docs and registry `setup_hint` on `main`).

**Not executed:** install, setup, or running REA binaries.

| Check | Result |
|-------|--------|
| `rea` / `rea-agents` on PATH | **Not found** |
| Running processes matching `rea` | **None observed** |

---

## Agent Core contract (`mcp.rea`)

On `main` @ `c3666b7`:

| Field | Value |
|-------|--------|
| `id` | `mcp.rea` |
| `status` | **PLANNED** |
| `execution_mode` | **HANDOFF** |
| `control_plane_execution` | **false** |
| `vps_execution` | **false** (metadata) |
| `sandbox_root` | `F:/projectAi/REA` (documentation hint in registry) |

Tests (`tests/rea-preflight.test.ts`):

- Registry assertions for PLANNED / HANDOFF / no control-plane execution.
- `/v2/execute` path via `interceptExecution` → **`executed: false`**, **`UNAVAILABLE`**, **`CAPABILITY_NOT_ACTIVE`**.

**PASS:** PLANNED capabilities do not execute on the control plane during this mission.

---

## Proposed installation model (after human approval only)

1. **Human** completes checklist in `docs/rea/LOCAL_PREFLIGHT.md` (AV policy, no secrets in REA tree, output redaction plan).
2. **Human** runs `npx rea-agents setup` on the developer machine (not on VPS).
3. **Human** adds Cursor MCP entry pointing at REA with cwd under `F:\projectAi\REA` (record command shape locally; do not commit secrets).
4. **Optional later:** set `mcp.rea` to **ACTIVE** in registry via PR — still **HANDOFF**; Agent Core must not execute REA on VPS without separate approval track per blueprint.
5. **Workflow:** samples → `inbox/` → analysis → `out/` / `quarantine/`; redact before any memory/GitHub sync.

---

## Rollback plan

| Step | Action |
|------|--------|
| 1 | Disable/remove REA MCP server in Cursor user config |
| 2 | Set `mcp.rea` to **`DISABLED`** in `capability-registry.ts` (PR) or leave **PLANNED** (current safe default) |
| 3 | Clear or archive `F:\projectAi\REA\inbox` / `quarantine` contents as needed |
| 4 | No VPS rollback required (REA not deployed there by design) |

---

## PASS / BLOCKED / UNKNOWN checklist

| Item | Status |
|------|--------|
| Sandbox directories exist | **PASS** |
| Sandbox outside agent-core repo | **PASS** |
| OS-level isolation enforced | **BLOCKED** (not implemented — folder only) |
| Defender RT protection on | **PASS** |
| No credential-like files in REA (by name) | **PASS** |
| REA MCP not installed | **PASS** |
| REA not in Cursor MCP config | **PASS** |
| `mcp.rea` PLANNED + HANDOFF on `main` | **PASS** |
| Tests block PLANNED execution | **PASS** |
| Mission ran REA or modified MCP config | **PASS** (did not) |
| Human preflight checklist complete | **UNKNOWN** (checklist items in doc still for human) |
| Safe analysis environment for malware | **UNKNOWN** (human / VM decision) |
| Private memory repo + redaction pipeline | **BLOCKED** (Phase C3 — not started) |
| Production / VPS REA | **BLOCKED** (by policy) |

---

## STOP lines (unchanged)

Do **not** proceed without explicit human approval:

- REA installation (`npx rea-agents setup`)
- Cursor MCP configuration changes
- Private memory repository creation
- Git push or merge of WIP
- Production or VPS operations

---

## Human approval gates

1. Sign off `docs/rea/LOCAL_PREFLIGHT.md` checklist (including AV and secret hygiene).
2. Choose analysis host (bare folder vs VM).
3. Approve MCP config diff before save.
4. Approve any registry change PLANNED → ACTIVE (separate PR).
5. Approve Phase C3 memory repo visibility and export/redaction tooling.
