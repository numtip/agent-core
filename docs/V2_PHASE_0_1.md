# Agent Core v2 — Phase V2-0 + V2-1

## Status

Implementation branch: `feat/v2-capability-registry-router`

Baseline commit: `3bb9c434569fb624ea5a429d672f20de04d094ab`

This phase is additive. No v1 public endpoint is removed or redefined.

## V2-0 — Baseline freeze

The v1 baseline is frozen at the commit above for compatibility comparison and rollback.

Guaranteed compatibility targets:

- `/v1/health`
- `/v1/decision`
- `/v1/route`
- `/v1/qa`
- `/v1/context`
- `/v1/subagent`
- `/v1/advanced-route`
- existing project authorization and hard-policy semantics
- existing adapters and project profiles

V2 changes must not bypass hard policy, project identity checks, or human approval gates.

## V2-1 — Capability Registry

A capability is a machine-readable execution or reasoning option. Supported kinds:

- `DETERMINISTIC`
- `MODEL`
- `AGENT`
- `TOOL`
- `SKILL`
- `MCP`
- `WORKFLOW`

Each capability declares:

- stable ID
- kind
- description
- tags
- allowed operation classes
- project scope
- risk level
- activation status
- priority
- metadata

Status values:

- `ACTIVE`
- `PLANNED`
- `DISABLED`

`PLANNED` capabilities are not routable by default. This allows future integrations (for example Playwright MCP) to be declared without pretending they are operational.

## Unified Router

New endpoint:

`POST /v2/route`

Routing order:

1. validate request
2. enforce authenticated project identity
3. enforce deterministic hard policy
4. build bounded capability candidates
5. remove disabled/planned/incompatible capabilities
6. score eligible candidates
7. return selected capability plus ranked candidates

The v1 `advanced-router` remains available and is used only as a compatibility tier signal. V2 selection is capability-based.

New registry endpoint:

`GET /v2/capabilities`

The endpoint requires the existing `route` scope and exposes declarative capability metadata only. It does not expose credentials or provider secrets.

## Safety invariants

- A routing decision is not execution permission.
- Hard policy runs before capability selection.
- Production write, destructive operations and protected project rules remain approval-gated.
- Secret/credential targets remain blocked by hard policy.
- Browser capability remains `PLANNED` until the browser-control phase.
- Capability registry entries contain no secrets.

## Acceptance criteria

- [x] v1 baseline commit recorded
- [x] additive feature branch created
- [x] typed capability schema implemented
- [x] default registry implemented
- [x] duplicate capability IDs rejected
- [x] planned capabilities excluded by default
- [x] unified route request schema implemented
- [x] hard-policy gate executes before routing
- [x] ranked candidate output implemented
- [x] `/v2/capabilities` implemented
- [x] `/v2/route` implemented
- [x] compatibility with `/v1/advanced-route` retained
- [x] unit/integration tests added
- [ ] CI passes on feature branch

## Next sequence

After V2-0/V2-1 acceptance:

1. V2 Gateway / interception layer
2. Context Governor
3. Playwright MCP browser control
4. Supervisor and workflow lifecycle

Do not activate planned browser or production execution capabilities before their dedicated safety gates and tests exist.
