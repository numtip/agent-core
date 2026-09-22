# Architecture

## System boundary

Agent Core is a shared control plane between project-side agents/tools and external AI/model providers.

```text
Client
  |
  v
Cloudflare
  |
  v
Agent Core API
  |
  +--> Hard Policy
  +--> Project Authorization
  +--> Context Builder
  +--> Decision Router
  |      +--> Jev
  |      +--> Frontier Model
  |      +--> Deterministic Rule
  |
  +--> Runtime / Tools
  +--> State
  +--> Audit / Metrics
```

## Core modules

### API

Initial endpoints:

- `GET /v1/health`
- `POST /v1/decision`
- `POST /v1/route`
- `POST /v1/qa`

Future:

- `POST /v1/context`
- `POST /v1/subagent`
- `GET /v1/projects`
- `GET /v1/metrics`

### Policy

Order of evaluation:

1. input/schema validation
2. authenticated project identity
3. project scope authorization
4. deterministic hard policy
5. optional Jev decision
6. human approval gate where required
7. execution

### Context

Context assembly is task-specific. Whole-repo ingestion is prohibited as a default strategy.

### Decision

All decision providers are behind an internal abstraction so projects never depend directly on Jev/OpenRouter protocol details.

### State

Local project state and global platform telemetry are separate concerns.

Project state examples:

- current task
- QA result
- changed artifacts
- project configuration

Platform state examples:

- decision events
- latency
- failures
- cost
- routing history
- overrides

### Runtime

Execution should remain deterministic where possible. Decision output is not equivalent to permission to execute.

## Runtime placement

Production target:

```text
Cloudflare Tunnel
      |
      v
127.0.0.1:<port>
      |
Agent Core process
```

No public application port is required on the VPS.

## Storage

Phase 1 may use SQLite for operational metadata.

PostgreSQL/Redis should be introduced only after measured scale or concurrency requires them.

## API compatibility

Version all public interfaces under `/v1`.

Breaking schema changes require a new API or schema version and documented migration path.
