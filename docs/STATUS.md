# Platform Status

## Current runtime line

- **Agent Core runtime version:** `0.6.0`
- **Architecture:** Agent Core v2 AI Control Plane
- **v1 API compatibility:** preserved
- **Production/live infrastructure activation:** not claimed by repository state alone

## v1 foundation

| Phase | Status | Notes |
|---|---|---|
| 0 Architecture Foundation | COMPLETE | Blueprint, architecture, security, API foundation |
| 1 Jev Decision Core | COMPLETE | Jev Decisions API adapter, confidence/fallback, tests |
| 2 VPS + Cloudflare package | CODE COMPLETE | Docker/systemd/Tunnel templates, auth, rate limit; live activation requires infrastructure credentials |
| 3 52Clips Pilot | READY TO ACTIVATE | Adapter and platform decision types ready; live project connection requires project runtime access |
| 4 Shared Client | COMPLETE | CLI health/doctor/decision/route/qa |
| 5 Existing Project Adapters | COMPLETE | 52Clips, attendance, handbook, goffice2026, dbplant profiles |
| 6 Context Intelligence | COMPLETE v1 | Deterministic bounded candidate ranking; avoids whole-repo default |
| 7 Advanced Routing | COMPLETE v1 | sensitivity/cost routing, hard-policy gate, subagent dedupe |
| 8 Control Center | COMPLETE v1 | private API-backed control-center surface |

## v2 implementation

| Phase | Status | Notes |
|---|---|---|
| V2-0 Baseline Freeze | COMPLETE | v1 baseline preserved for rollback and compatibility |
| V2-1 Capability Registry + Unified Router | COMPLETE | typed registry, lifecycle, policy-first candidate filtering, `/v2/route` |
| V2-2 Gateway / Interceptor | COMPLETE | progressive disclosure, search, execution contracts, `/v2/execute` |
| V2-3 Context Governor | COMPLETE | KEEP/COMPRESS/DROP/PIN, protected context, context receipts and reduction metrics |
| V2-4 Browser Control Plane | CODE COMPLETE | Playwright MCP policy-controlled handoff, browser scope, URL/domain checks, injection guard, action-risk and receipts |
| V2-5 Supervisor | NOT STARTED | multi-agent/workflow coordination phase |
| V2-6 Control Center v2 | NOT STARTED | v2 metrics/receipts/workflow visibility |
| V2-7 Project migration | NOT STARTED | migrate project clients to v2 capability/gateway contracts |
| V2-8 Production activation + benchmark | EXTERNAL GATE | requires live VPS/Cloudflare/OpenRouter/Playwright runtime verification |

## Browser activation state

`mcp.playwright` is an **ACTIVE control-plane capability** with execution mode `HANDOFF`.

This means Agent Core can policy-check and produce a Playwright MCP execution contract. It does **not** mean the repository itself has proven a live MCP transport connection on the VPS.

Live browser execution still requires:

- a Playwright MCP runtime/adapter reachable by Agent Core or an authorized client
- explicit per-project `browser` scope
- runtime domain policy
- production/external-write approval rules
- end-to-end QA against a real website

## External activation state

Production activation is intentionally **not claimed** until the required live infrastructure is available to the execution environment and verified end-to-end:

- authorized VPS access
- authorized Cloudflare account/Tunnel configuration
- live OpenRouter/Jev connectivity
- live Playwright MCP transport for browser execution
- project machine identities/scopes

No repository code or CI result can substitute for live infrastructure verification.
