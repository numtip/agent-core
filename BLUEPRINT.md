# Jev Agent Platform — Development Blueprint

**Version:** 1.0  
**Status:** Architecture Source of Truth  
**Runtime:** VPS  
**Ingress/Security:** Cloudflare  
**Source Control:** GitHub  
**Decision Engine:** Jev via OpenRouter

## 1. Vision

Build one shared AI decision infrastructure that every current and future project can consume without duplicating routing, state, policy, security, context, QA, or observability logic.

> Projects do not embed Jev. Projects consume Agent Core.

## 2. Responsibility model

### Jev — decision layer

Use Jev for bounded structured decisions:

- classification
- ranking
- routing
- confidence scoring
- retry/stop decisions
- tool selection
- model selection
- subagent selection
- QA disposition
- human escalation

Jev is not the primary content/code generator.

### Frontier LLM — reasoning layer

Use frontier models for:

- programming
- debugging
- planning
- analysis
- writing
- creative work
- complex code review

### Deterministic runtime — execution layer

Use ordinary code and tools for:

- file operations
- Git
- build/test
- schema validation
- FFmpeg/media operations
- data transformations
- deployment mechanics

### Human — approval layer

Human approval remains authoritative for:

- production deployment
- destructive operations
- sensitive-data access
- high-risk changes
- final creative/business approval

## 3. Target architecture

```text
                         USER
                          |
                          v
              Cursor / Codex / CLI / App
                          |
                        HTTPS
                          |
                          v
                  +---------------+
                  |  CLOUDFLARE   |
                  | DNS / Access  |
                  | WAF / Limits  |
                  | Tunnel        |
                  +-------+-------+
                          |
                          v
                  +---------------+
                  |  AGENT CORE   |
                  |     VPS       |
                  |---------------|
                  | API Gateway   |
                  | Registry      |
                  | Policy        |
                  | Context       |
                  | Decisions     |
                  | State         |
                  | QA            |
                  | Telemetry     |
                  +-------+-------+
                          |
            +-------------+-------------+
            |                           |
            v                           v
           Jev                    Frontier / Tools
        OpenRouter                 / Subagents
```

## 4. Infrastructure placement

### GitHub

GitHub is the source of truth for:

- source code
- version control
- API schemas
- policies that contain no secrets
- documentation
- tests
- deployment definitions
- release metadata

GitHub Pages may host public/static documentation, but must not host the runtime API or private state.

### VPS

The VPS runs the Agent Core runtime.

Suggested layout:

```text
/opt/agent-core/
├── app/
├── config/
├── policies/
├── adapters/
├── state/
├── data/
├── logs/
└── runtime/
```

The application should bind to loopback only and be exposed through Cloudflare Tunnel.

### Cloudflare

Cloudflare is the front door:

- DNS
- TLS
- Tunnel
- Access
- WAF
- rate limiting
- optional API Shield / mTLS later

Cloudflare is not the Jev runtime.

### OpenRouter / Jev

The OpenRouter key exists only in the protected runtime environment. Projects never receive the upstream provider secret.

## 5. Project integration

Each project should expose a small configuration surface:

```text
.ai/
├── jev.yaml
├── policies.yaml
├── state/
├── tasks/
├── decisions/
└── qa/
```

Example:

```yaml
schema_version: 1

project:
  id: goffice2026
  type: web

platform:
  enabled: true
  endpoint: https://agent.example.com

features:
  task_route: true
  context_route: true
  tool_route: true
  model_route: true
  subagent_route: true
  qa_disposition: true
  human_escalation: true

context:
  strategy: task_specific
  max_candidates: 40

fallback:
  enabled: true
```

## 6. Core decisions

Agent Core v1 standardizes these decision types:

```text
TASK_ROUTE
CONTEXT_ROUTE
TOOL_ROUTE
MODEL_ROUTE
SUBAGENT_ROUTE
NEXT_ACTION
QA_DISPOSITION
HUMAN_ESCALATION
```

All decisions should return structured data, not unconstrained prose.

Example:

```json
{
  "decision_type": "NEXT_ACTION",
  "result": "GENERATE_SUBTITLE",
  "confidence": 0.96,
  "reason_code": "SUBTITLE_MISSING"
}
```

## 7. Confidence and fallback

Initial policy:

```text
>= 0.85  -> eligible for policy-controlled execution
0.60-.84 -> additional validation / frontier review
< 0.60   -> safe fallback or human escalation
```

These thresholds are provisional and must be tuned from telemetry.

Jev failure must never stop the whole project. Required fallback conditions include:

- timeout
- provider outage
- invalid output schema
- low confidence
- rate limiting
- network errors

## 8. Context engineering

Do not default to reading a whole repository.

```text
Task
 |
 v
Candidate discovery
 |
 v
Deterministic filtering
 |
 v
Jev relevance/ranking
 |
 v
Selected context
 |
 v
Agent
```

Filter first by deterministic signals such as path, file type, changed files, symbols, task ID, Git diff, recent failures, and project type. Use Jev to rerank only a bounded candidate set.

## 9. Explicit state

Conversation history is not the source of truth.

State should be machine-readable and resumable:

```json
{
  "task_id": "GOFFICE-2026-094",
  "project": "goffice2026",
  "goal": "Fix water dashboard chart",
  "state": "QA",
  "files_changed": ["src/components/WaterChart.tsx"],
  "tests": {"status": "PASS"}
}
```

## 10. Security

Defense in depth:

```text
Cloudflare
   |
Tunnel
   |
Access identity
   |
Agent Core authorization
   |
Hard runtime policy
   |
Jev decision
   |
Human approval when required
```

Hard rules execute before probabilistic decisions. Secrets, private keys and restricted files must never depend on Jev alone for protection.

## 11. Authentication

Every project gets an independent machine identity / credential. Credentials must be independently revocable.

Application authorization checks:

- project
- scope
- operation
- environment
- policy version

Cloudflare authentication does not replace application authorization.

## 12. Observability

Every important decision must record enough metadata to answer:

- What was requested?
- Which project/task?
- What was decided?
- With what confidence?
- Which policy/version applied?
- Was fallback used?
- What action actually happened?
- How much did it cost?
- How long did it take?
- Did a human override it?

Decision and execution logs must remain distinct.

## 13. Tool disclosure

Use progressive disclosure:

1. capability snippet
2. schema for selected tools
3. deeper documentation only when needed

Do not load hundreds of tool schemas on every turn.

## 14. Subagents

A subagent receives minimal task-specific context, not the full parent transcript.

Before spawning:

- classify read/write behavior
- deduplicate against active/completed subgoals
- select minimal context
- define structured output contract

## 15. Read/write classification

Operations are typed:

- `READ`
- `WRITE`
- `DESTRUCTIVE`
- `EXTERNAL`

Read-only work may parallelize. Write operations require conflict/state checks and policy.

## 16. Project adapters

Core infrastructure remains shared. Project-specific behavior lives in adapters.

Initial adapters:

```text
adapters/
├── 52clips/
├── attendance-report-generator/
├── handbook/
├── goffice2026/
└── dbplant/
```

## 17. Rollout

1. Architecture foundation
2. Jev decision core
3. VPS + Cloudflare
4. 52Clips pilot
5. Shared CLI/client
6. Existing project migration
7. Context intelligence
8. Advanced cost/security-aware routing
9. Private control center

## 18. Non-goals for v1

Do not build:

- a replacement for Cursor/Codex
- a fully autonomous coding agent
- automatic production deployment
- AI-only security
- whole-repo Jev scoring every turn
- Kubernetes
- a large tool marketplace

## 19. North Star

The platform should let projects state:

```text
What do I need?
What is my state?
What am I allowed to do?
```

Agent Core should determine:

```text
What context is needed?
Who should decide?
Which model/tool should execute?
Is it safe?
Did it succeed?
What happens next?
```

This repository is the architecture source of truth for that platform.
