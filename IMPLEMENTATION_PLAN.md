# Technical Implementation Plan

## Phase 0 — Architecture Foundation

Deliverables:

- [x] Repository initialized
- [x] Blueprint
- [x] Architecture baseline
- [x] Security baseline
- [x] OpenAPI skeleton
- [x] Environment template
- [ ] Technology/runtime choice finalized
- [ ] ADR for deployment packaging
- [ ] CI validation workflow

Exit criterion: repository is a usable architecture source of truth.

## Phase 1 — Decision Core

Build:

- `GET /v1/health`
- `POST /v1/decision`
- Jev provider adapter
- structured request/response schemas
- confidence policy
- timeout/error handling
- deterministic fallback
- structured event logging
- unit tests

Exit criterion: bounded Jev decisions are reliable under local test.

## Phase 2 — VPS + Cloudflare

Build:

- runtime packaging
- system service/container
- Cloudflare Tunnel
- Access machine authentication
- application project authorization
- rate limiting
- origin firewall/bind policy
- deployment/rollback procedure

Exit criterion: authenticated remote client can call Agent Core without exposing the VPS application port.

## Phase 3 — 52Clips Pilot

Enable only:

- `NEXT_ACTION`
- `QA_DISPOSITION`
- `SUBAGENT_ROUTE`

Measure:

- decision agreement/override rate
- confidence
- latency
- errors
- fallbacks
- upstream cost
- token usage where available

Do not expand scope until pilot metrics are reviewed.

## Phase 4 — Shared Client

Create a reusable CLI/client:

```text
agent health
agent decide
agent route
agent qa
agent doctor
```

Projects should not know provider-specific API details.

## Phase 5 — Existing Projects

Migration order:

1. 52Clips
2. attendance-report-generator
3. handbook
4. goffice2026
5. dbplant

dbplant remains read-only by default until its production safety gates are separately approved.

## Phase 6 — Context Intelligence

Introduce:

- candidate discovery
- deterministic filtering
- bounded Jev reranking
- context visibility
- shared retrieval for read-only background tasks

## Phase 7 — Advanced Routing

Introduce only after telemetry supports the need:

- cost-aware model routing
- security-aware provider routing
- dynamic subagents
- subgoal deduplication
- shared read-only context

## Phase 8 — Control Center

Private dashboard behind Cloudflare Access:

- project health
- request/decision counts
- latency
- confidence
- errors
- fallback rate
- human override rate
- cost
- provider health

## v1 Definition of Done

- [ ] VPS runtime deployed
- [ ] Cloudflare Tunnel active
- [ ] per-project authentication active
- [ ] no public origin API port
- [ ] OpenRouter/Jev integration active
- [ ] health endpoint passing
- [ ] decision endpoint passing
- [ ] schema validation passing
- [ ] confidence handling tested
- [ ] audit logging active
- [ ] fallback tested
- [ ] project authorization active
- [ ] rate limits active
- [ ] 52Clips pilot connected
- [ ] baseline metrics collected
- [ ] human override supported
- [ ] security tests passed
