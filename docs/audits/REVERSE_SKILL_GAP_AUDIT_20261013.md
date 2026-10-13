# reverse-skill gap audit — 2026-10-13

**Labels:** audit **VERIFIED** locally against `main` @ `4efa871`. Runtime **unchanged**. Not **DEPLOYED**. Not **ACTIVATED**.

**Decision:** no capability adopted. Zero source files changed. `mcp.rea` stays **PLANNED / HANDOFF**. REA remains the reverse-engineering engine. Codex Computer Use is untouched.

## Provenance (not vendored)

| Source | Pin | License | Use |
|---|---|---|---|
| [zhaoxuya520/reverse-skill](https://github.com/zhaoxuya520/reverse-skill) | `1.0.1` @ `cab634bd855fc287f6e420c1f36fd1a6b9245960` (2026-10-13) | MIT | Catalog read only. No files copied into this repo. |
| [morluto/rea](https://github.com/morluto/rea) `rea-agents@6.4.0` | local Cursor `user-rea`, 170 tools | MIT | Existing handoff target. Not modified. |
| Agent Core | `main` `4efa871` | private package, no root LICENSE | Routing, policy, audit, registry, knowledge. |

No third-party skill, script, or toolchain was installed. MIT notice is not added here because no substantial portion of reverse-skill was copied.

## What already exists (do not import)

| Surface | Owner | Evidence |
|---|---|---|
| Capability registry + selection | Agent Core | `src/capability-registry.ts` `defaultCapabilities`; duplicate ids throw `CAPABILITY_EXISTS` |
| Unified route | Agent Core | `src/unified-router.ts` `unifiedRoute` — hard policy before score |
| Gateway | Agent Core | `src/gateway.ts` `interceptExecution` |
| Jev confidence / fallback | Agent Core | `src/services/decision.ts` `applyConfidencePolicy` |
| Browser + SSRF + approval | Agent Core | `src/browser-control.ts`; kill switch `PLAYWRIGHT_MCP_EXECUTION_ENABLED` |
| MCP pattern | Agent Core | Playwright is the only in-process MCP client. OpenWiki and REA are handoffs. No global MCP registrar. |
| Knowledge / provenance | Agent Core | `src/knowledge-fabric.ts` `queryKnowledgeFabric` — read-only, `CONTEXT_ONLY` |
| Audit receipts | Agent Core | `src/telemetry.ts` `AuditLogger.write` |
| RE execution | REA via Cursor `user-rea` | `mcp.rea` metadata `execution_mode: HANDOFF`, `control_plane_execution: false` (`capability-registry.ts`) |
| RE tool gate | Agent Core | `POST /v2/rea/route` (`src/rea-local/route.ts`); profiles v1/v2 in `src/rea-local/allowlist-profiles.ts` allow 2 or 4 tools. Other catalog tools denied. |
| Computer Use | Codex worker | No `computer_use` module in Agent Core or `rea-agents@6.4.0`. |

## Classification

`REUSE` = call the existing module. `EXTEND` = small change to that module. `ADOPT` = bring the capability in. `REJECT` = do not import.

reverse-skill's own contract (`skills/MASTER-ROUTING.md`) is a second router plus on-demand tool bootstrap plus a case-directory framework. Those three are out of scope for this repo.

| Candidate | Class | Why |
|---|---|---|
| `master-route` / `routing.json` / role map | **REJECT** | Duplicate router. Agent Core already selects capabilities and REA tools. |
| Tool bootstrap / `tool-index` / Kali pack | **REJECT** | Automatic install is forbidden. Supply-chain risk. REA engines are a human preflight (`docs/rea/LOCAL_PREFLIGHT.md`). |
| Global skill or MCP registration | **REJECT** | Would register a second tool plane beside `user-rea` and Playwright. |
| Ghidra, IDA, Binary Ninja, radare2, APK/jadx, .NET, Mach-O, JS/CDP, firmware extract, Go/Rust binaries | **REJECT** | REA already covers these target classes (native, Android, managed, Apple, JS/web, firmware). A second decompiler skill pack duplicates the engine. |
| `binary-diff` | **REJECT** | REA static compare tools (`compare_functions`, `compare_bundles`, `compare_artifacts`, `compare_source_to_bundle`) already exist; they stay off the Jev allowlist until explicitly classified. |
| `browser-automation` | **REJECT** | Duplicate of `mcp.playwright`. Desktop click/type stays with the Codex Computer Use worker. |
| `attack-chain`, `pwn-chain`, `patch-diff-exploit`, `edr-bypass-re`, `pentest-tools` / src-hunter, `windows-ad`, `wifi-wireless`, `ctf-sandbox` | **REJECT** | Operational attack, exploit, bypass, or sandbox-orchestration content. Not an Agent Core capability. |
| API, cloud/K8s, database, identity, email, OT/ICS, radio, thick-client, LLM, malware dynamic, hardware debug | **REJECT** | Assessment playbooks, not missing control-plane functions. Several include offensive procedures. No measurable gain inside routing/policy/audit. |
| `code-audit`, `supply-chain-security`, `threat-hunting`, `threat-intelligence`, `digital-forensics` | **REJECT** | Adjacent security workflows. Importing them would add scanners and case stores this control plane does not own. |
| `docs-generator`, `diagram-generator`, `field-journal` | **REJECT** | Documentation helpers. Not a reverse-engineering execution gap. |
| `case-review` (Evidence → Finding → Path, hash fixity, `work/<case>/`) | **REJECT** | Read-only and MIT, but it is a new case-package framework. REA already returns Evidence, unknowns, and bundles. Agent Core already writes receipts, audit rows, and knowledge provenance. A parallel case root would duplicate both. |
| Protocol recovery as a new Agent Core tool | **REJECT** | No read-only protocol tool is on the REA allowlist. Adding one belongs in REA, then a future allowlist review — not a vendored skill. |

**ADOPT count: 0. EXTEND count: 0.**

## Baseline vs enhanced

| Check | Baseline `4efa871` | After this audit |
|---|---|---|
| Runtime modules | registry, Jev, gateway, Playwright MCP, knowledge fabric, `/v2/rea/route` | Same files |
| `mcp.rea` status | PLANNED / HANDOFF | Unchanged |
| Allowlist | v1: 2 tools; v2: 4 tools | Unchanged |
| Computer Use | Not in Agent Core | Unchanged |
| Tool install / production | Not performed | Not performed |
| Regression | `npm test` on `4efa871`: **109 passed, 1 skipped** (`jev-rea-live`, needs `LIVE_JEV_REA=1`), 22 files passed | Same suite. Docs-only diff does not change runtime |

## Rollback

Revert this documentation commit. No service restart, env change, registry edit, or migration.

## Gates

| Gate | Result |
|---|---|
| NO_DUPLICATE_CAPABILITIES | Pass — nothing imported |
| MINIMAL_CHANGESET | Pass — audit doc + index row |
| REA_COMPATIBLE | Pass — handoff contract unchanged |
| COMPUTER_USE_UNCHANGED | Pass |
| SECURITY_REGRESSION_PASS | Pass — 109 passed, 1 live test skipped, on `4efa871` before this docs commit |
| BASELINE_VS_ENHANCED_REPORTED | Pass — no runtime delta |
