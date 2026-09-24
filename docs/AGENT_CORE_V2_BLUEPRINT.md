# Agent Core v2 — AI Control Plane Blueprint

**Version:** 2.0 Blueprint  
**Status:** Proposed Architecture Source of Truth  
**Repository:** `numtip/agent-core`  
**Baseline:** Agent Core v1 code-complete through Phase 8  
**Runtime:** VPS  
**Ingress/Security:** Cloudflare  
**Decision Engine:** Jev via OpenRouter  
**Primary Design Goal:** one reusable control plane for all current and future projects

---

## 1. Executive intent

Agent Core v2 evolves v1 from a shared Jev decision service into a full **AI Control Plane**.

The platform must answer five questions for every task:

1. **What is this task?**
2. **Who/what should handle it?**
3. **What context is actually needed?**
4. **Is the requested action allowed and safe?**
5. **Did execution succeed, and what happens next?**

The core principle remains unchanged:

> Projects do not embed Jev, provider secrets, routing logic, browser policy, or context-management logic. Projects consume Agent Core.

v2 adds four first-class capabilities:

- JevRouter-style unified capability routing
- Jev Gateway-style tool/model/agent interception
- Playwright MCP browser control with policy gates
- Context Governor for compaction, relevance, and resumable state

A fifth capability, **Supervisor**, coordinates long-running or multi-agent workflows.

---

## 2. Non-negotiable design principles

### 2.1 Jev is the decision layer, not the primary worker

Use Jev for bounded structured decisions:

- intent classification
- capability selection
- model/tool/agent/skill routing
- confidence scoring
- retry/stop/escalate decisions
- browser action selection
- context relevance
- QA disposition
- workflow supervision

Use frontier LLMs for:

- deep reasoning
- coding
- debugging
- research synthesis
- document writing
- creative generation
- complex review

Use deterministic code for:

- auth
- policy enforcement
- file I/O
- Git
- testing
- schemas
- deployments
- data transforms
- media pipelines
- state transitions

### 2.2 Decision is not permission

A Jev result can recommend an action, but it cannot bypass hard policy.

Required order:

```text
request
  -> schema validation
  -> identity/authentication
  -> project authorization
  -> hard policy
  -> routing/decision
  -> approval gate if required
  -> execution
  -> verification
  -> audit receipt
```

### 2.3 Agent Core is provider-agnostic

Projects must never depend directly on OpenRouter/Jev protocol details.

All providers live behind internal adapters.

### 2.4 Context is bounded by default

Whole-repository or whole-history loading is prohibited as the default strategy.

### 2.5 Human authority remains final

Human approval remains authoritative for:

- production deployment
- destructive operations
- sensitive-data access
- privilege expansion
- irreversible external actions
- high-impact business/creative approval

---

## 3. Target architecture

```text
                               USER / PROJECT
                                     |
                                     v
                  Cursor / Codex / Hermes / CLI / App
                                     |
                                   HTTPS
                                     |
                                     v
                           +-------------------+
                           |    CLOUDFLARE     |
                           | DNS / TLS / Access|
                           | WAF / Rate Limit  |
                           | Tunnel            |
                           +---------+---------+
                                     |
                                     v
                  +-----------------------------------+
                  |         AGENT CORE v2             |
                  |         AI CONTROL PLANE          |
                  |-----------------------------------|
                  | API Gateway / Auth                |
                  | Capability Registry               |
                  | Hard Policy / Approval            |
                  | Unified Router                    |
                  | Gateway / Interceptor             |
                  | Context Governor                  |
                  | Supervisor                        |
                  | Browser Control                   |
                  | State / Workflow                  |
                  | Evaluation / QA                   |
                  | Observability / Receipts          |
                  +---------------+-------------------+
                                  |
              +-------------------+-------------------+
              |                   |                   |
              v                   v                   v
          Jev Decisions       Frontier Models      Tools/Agents
          via OpenRouter      GPT/Claude/etc.      MCP/CLI/Git
                                                    Playwright
                                                    Cursor/Codex
                                                    Hermes/etc.
```

---

## 4. v2 capability model

Every executable resource is represented in one registry.

Supported capability types:

```text
MODEL
AGENT
SUBAGENT
TOOL
SKILL
MCP_SERVER
WORKFLOW
BROWSER_ACTION
DETERMINISTIC_HANDLER
```

Example registry entry:

```yaml
id: browser.playwright
kind: MCP_SERVER
provider: local
capabilities:
  - navigate
  - inspect_dom
  - click
  - fill
risk:
  default: READ
  elevated_actions:
    - submit
    - delete
    - publish
requirements:
  - browser_access
cost_class: low
latency_class: medium
healthcheck: enabled
```

The router selects from this registry instead of hard-coding project-specific branches.

---

## 5. Module A — Unified Router

### Purpose

Choose the best capability for a bounded task while respecting policy, cost, confidence, environment, and availability.

### Inputs

```json
{
  "project": "goffice2026",
  "task_type": "QA_WEB",
  "goal": "verify dashboard links",
  "environment": "preview",
  "allowed_scopes": ["READ", "BROWSER"],
  "candidate_capabilities": ["..."]
}
```

### Output

```json
{
  "decision_type": "CAPABILITY_ROUTE",
  "selected": "browser.playwright",
  "confidence": 0.93,
  "fallback": "agent.frontier",
  "reason_code": "WEB_QA_MATCH",
  "policy_version": "v2"
}
```

### Required routing dimensions

- intent
- project type
- action class
- required permissions
- sensitivity
- cost budget
- latency preference
- current provider health
- historical success
- confidence

### Rule

Hard policy filters candidates **before** Jev ranking.

---

## 6. Module B — Gateway / Interceptor

### Purpose

Intercept tool/model/agent selection so clients do not need hundreds of schemas or provider-specific routing logic.

### Flow

```text
Agent intent
   |
   v
Gateway
   |
   +--> hard-policy candidate filter
   +--> progressive capability disclosure
   +--> Jev route
   +--> confidence/fallback
   +--> execute selected capability
   +--> verify result
```

### Progressive disclosure

Level 1 — capability summary  
Level 2 — selected schema  
Level 3 — full docs only if required

This reduces token pressure and prevents every client from loading every tool definition on every step.

### API additions

```text
POST /v2/route
POST /v2/execute
POST /v2/capabilities/search
GET  /v2/capabilities/:id
```

`/v1` remains backward-compatible during migration.

---

## 7. Module C — Browser Control Plane

### Purpose

Provide reusable browser automation without giving autonomous agents unrestricted web control.

### Architecture

```text
Agent
  |
  v
Agent Core
  |
  +--> URL/domain policy
  +--> action risk classifier
  +--> prompt-injection guard
  +--> DOM/state reducer
  +--> Jev browser action routing
  +--> approval gate
  |
  v
Playwright MCP
  |
  v
Website
```

### Browser action classes

```text
BROWSER_READ
BROWSER_NAVIGATE
BROWSER_INPUT
BROWSER_SUBMIT
BROWSER_EXTERNAL_WRITE
BROWSER_DESTRUCTIVE
```

### Default policy

- read/navigation: eligible for autonomous execution
- form fill without submit: policy-controlled
- submit/publish/send: explicit write permission required
- delete/payment/account/security changes: human approval required

### Browser safety requirements

- domain allow/deny lists
- redirect validation
- prompt-injection detection
- page text treated as untrusted input
- no secret exposure to DOM unless strictly required
- screenshot/DOM snapshot limits
- submission receipts
- deterministic timeout and retry limits

---

## 8. Module D — Context Governor

### Purpose

Keep long-running projects accurate, cheap, resumable, and resistant to context drift.

### Context lifecycle

```text
Task
  -> candidate discovery
  -> deterministic filtering
  -> Jev relevance ranking
  -> context bundle
  -> agent execution
  -> result classification
  -> KEEP / COMPRESS / DROP
  -> durable state update
```

### Compaction dispositions

```text
KEEP
COMPRESS
DROP
PIN
```

### Never drop automatically

- explicit user requirements
- accepted architecture decisions
- safety/policy constraints
- unresolved blockers
- deployment state
- QA failures
- source-of-truth identifiers
- approval requirements

### Candidate signals

- changed files
- current task ID
- Git diff
- recent failures
- referenced symbols
- matching paths
- project adapter
- workflow state
- explicit pinned context

### Context receipt

Every execution should be able to report which context items were used and why.

---

## 9. Module E — Supervisor

### Purpose

Coordinate multi-step and multi-agent work without turning Agent Core into a fully autonomous coding agent.

### Supervisor decisions

```text
CONTINUE
DELEGATE
WAIT_FOR_DEPENDENCY
RETRY
VERIFY
ESCALATE
STOP_SUCCESS
STOP_FAILURE
```

### Supervisor responsibilities

- detect stuck agents
- detect repeated failed actions
- deduplicate subgoals
- choose read-only parallelism
- serialize conflicting writes
- trigger QA
- trigger human approval gates
- stop runaway workflows

### Example

```text
Research Agent -----+
Coding Agent -------+--> Supervisor --> QA Agent --> Policy Gate
Browser Agent ------+
```

The Supervisor never bypasses authorization or production approval rules.

---

## 10. Policy and risk engine

Operations remain typed:

```text
READ
WRITE
DESTRUCTIVE
EXTERNAL
SENSITIVE
PRODUCTION
```

Recommended risk matrix:

| Class | Default behavior |
|---|---|
| READ | autonomous if authorized |
| WRITE | policy-controlled execution |
| EXTERNAL | explicit scope required |
| SENSITIVE | restricted capability + audit |
| DESTRUCTIVE | human approval |
| PRODUCTION | human approval + verification |

Policy decisions must be deterministic wherever possible.

Jev may classify/rank risk candidates but does not own the final permission decision.

---

## 11. State model

Conversation history is not authoritative state.

### Task state

```json
{
  "task_id": "GOFFICE-2026-094",
  "project": "goffice2026",
  "goal": "verify dashboard",
  "phase": "QA",
  "status": "IN_PROGRESS",
  "capability": "browser.playwright",
  "files_changed": [],
  "checks": [],
  "approvals": [],
  "last_receipt": "..."
}
```

### Workflow state machine

```text
CREATED
  -> ROUTED
  -> RUNNING
  -> VERIFYING
  -> APPROVAL_REQUIRED
  -> COMPLETED
  -> FAILED
  -> CANCELLED
```

State transitions must be idempotent and auditable.

---

## 12. Evaluation and verification

v2 separates three concepts:

1. **Decision quality** — did routing choose a sensible capability?
2. **Execution success** — did the selected tool/agent complete the operation?
3. **Outcome quality** — did the task meet project acceptance criteria?

### Standard dispositions

```text
PASS
PASS_WITH_WARNING
RETRY
FALLBACK
HUMAN_REVIEW
FAIL
```

### Required metrics

- routing agreement rate
- human override rate
- fallback rate
- retry rate
- provider failure rate
- context reduction ratio
- browser action success rate
- cost per task
- latency per task
- task completion rate
- policy-block count

---

## 13. Observability and decision receipts

Every significant action produces a receipt.

Example:

```json
{
  "receipt_id": "rct_...",
  "task_id": "...",
  "project": "handbook",
  "decision": "browser.playwright",
  "confidence": 0.91,
  "policy": "v2.1",
  "action_class": "BROWSER_READ",
  "executed": true,
  "verified": true,
  "fallback_used": false,
  "cost": 0.0021,
  "latency_ms": 412
}
```

Decision logs and execution logs remain separate.

Do not log raw secrets, private keys, tokens, or unnecessary sensitive content.

---

## 14. Security architecture

```text
Cloudflare
   |
Access / machine identity
   |
Agent Core authentication
   |
Project authorization
   |
Hard policy
   |
Capability filtering
   |
Jev ranking
   |
Approval gate
   |
Execution
   |
Verification
   |
Audit receipt
```

### Required guarantees

- OpenRouter/provider keys exist only in protected runtime environment
- per-project credentials independently revocable
- least privilege by project and environment
- no public VPS application port
- origin access through Cloudflare Tunnel
- browser pages are untrusted inputs
- production/deletion cannot rely on probabilistic approval
- all privileged writes create receipts

---

## 15. Project integration contract

Projects keep a small `.ai/` surface:

```text
.ai/
├── agent-core.yaml
├── policies.yaml
├── capabilities.yaml
├── state/
├── tasks/
├── decisions/
└── qa/
```

Example:

```yaml
schema_version: 2

project:
  id: goffice2026
  type: web

platform:
  endpoint: https://agent.example.com

routing:
  unified: true
  tool_gateway: true
  supervisor: true

browser:
  enabled: true
  allowed_domains:
    - numtip.github.io
    - goffice.mju.ac.th

context:
  governor: true
  max_candidates: 50
  compaction: true

approval:
  production: human
  destructive: human
```

---

## 16. Adapter strategy

Existing adapters remain useful.

Initial v2 profiles:

```text
adapters/
├── 52clips/
├── attendance-report-generator/
├── handbook/
├── goffice2026/
├── dbplant/
└── generic/
```

Adapters define constraints and defaults, not duplicate control-plane logic.

`generic` is mandatory so future repositories can onboard without bespoke code.

---

## 17. Migration strategy

v2 is additive.

Do not break `/v1` clients during rollout.

### Phase V2-0 — Baseline freeze

- tag current v1 architecture baseline
- capture existing tests and API behavior
- document activation state

**Exit:** v1 behavior reproducible.

### Phase V2-1 — Capability Registry + Unified Router

Build:

- capability schema
- registry loader
- capability search
- policy pre-filter
- Jev capability ranking
- deterministic fallback

**Exit:** a task can route among model/agent/tool/skill/MCP candidates through one contract.

### Phase V2-2 — Gateway / Interceptor

Build:

- `/v2/route`
- `/v2/execute`
- progressive schema disclosure
- execution envelope
- receipt format

**Exit:** clients can request capabilities without provider-specific integration.

### Phase V2-3 — Context Governor

Build:

- KEEP/COMPRESS/DROP/PIN classification
- bounded candidate reranking
- durable pinned context
- context receipts
- compaction telemetry

**Exit:** long sessions remain resumable without whole-history dependence.

### Phase V2-4 — Playwright MCP Browser Plane

Build:

- Playwright MCP adapter
- browser action classification
- domain policy
- prompt-injection guard
- submit/destructive approval gate
- browser QA receipts

Pilot projects:

1. handbook
2. goffice2026

**Exit:** read-only browser QA can run safely end-to-end.

### Phase V2-5 — Supervisor

Build:

- task progress evaluator
- stuck/repetition detector
- retry budget
- subgoal dedupe
- parallel READ scheduling
- conflicting WRITE serialization

**Exit:** bounded multi-agent workflows complete with deterministic stop conditions.

### Phase V2-6 — Control Center v2

Add:

- route traces
- capability health
- context reduction
- browser action history
- supervisor state
- policy blocks
- receipts

**Exit:** an operator can explain why any major action occurred.

### Phase V2-7 — Project Migration

Recommended order:

1. handbook
2. goffice2026
3. 52Clips
4. attendance-report-generator
5. dbplant

`dbplant` remains read-only by default until separately approved.

### Phase V2-8 — Production Activation and Benchmark

- VPS deploy
- Cloudflare activation
- live OpenRouter/Jev QA
- route benchmark
- failure/fallback tests
- browser safety tests
- rollback drill

**Exit:** production-ready v2 release candidate.

---

## 18. Acceptance criteria

Agent Core v2 is considered complete when all are true:

- [ ] v1 API remains compatible or has documented migration path
- [ ] unified capability registry operational
- [ ] Jev routing supports model/agent/tool/skill/MCP candidates
- [ ] hard policy filters candidates before Jev
- [ ] low-confidence routing has deterministic fallback
- [ ] gateway provides progressive capability disclosure
- [ ] context governor supports KEEP/COMPRESS/DROP/PIN
- [ ] pinned requirements survive compaction
- [ ] Playwright MCP works through browser policy gates
- [ ] destructive/browser-submit actions require proper approval
- [ ] prompt-injection defense tested
- [ ] supervisor has retry/stuck/stop budgets
- [ ] write conflicts are serialized
- [ ] all privileged actions emit receipts
- [ ] costs, latency, confidence, fallback, override metrics visible
- [ ] provider outage does not stop the platform
- [ ] no provider secret is exposed to projects
- [ ] no public VPS origin port required
- [ ] rollback procedure tested
- [ ] handbook pilot passes
- [ ] goffice2026 pilot passes

---

## 19. Explicit non-goals

v2 will not become:

- a replacement for Cursor/Codex/Hermes
- a fully autonomous unrestricted coding agent
- a secret manager replacement
- an AI-only security layer
- an automatic production deployment system
- a browser bot with unrestricted write authority
- Kubernetes-based infrastructure without measured need
- a marketplace that installs arbitrary third-party agents automatically

---

## 20. Recommended repository structure

```text
src/
├── api/
│   ├── v1/
│   └── v2/
├── auth/
├── registry/
├── router/
│   ├── capability-router.ts
│   ├── model-router.ts
│   ├── agent-router.ts
│   ├── tool-router.ts
│   └── skill-router.ts
├── gateway/
├── context/
│   ├── governor.ts
│   ├── compactor.ts
│   ├── relevance.ts
│   └── pinned-context.ts
├── browser/
│   ├── playwright-mcp.ts
│   ├── browser-policy.ts
│   ├── injection-guard.ts
│   └── browser-receipt.ts
├── supervisor/
│   ├── progress.ts
│   ├── stuck-detector.ts
│   ├── retry-budget.ts
│   └── scheduler.ts
├── policy/
├── state/
├── eval/
├── observability/
├── providers/
│   ├── openrouter-jev.ts
│   └── frontier-model.ts
└── runtime/
```

---

## 21. North Star workflow

Future projects should need only a small integration contract.

```text
Project says:
  "Here is my goal, state, permissions and constraints."

Agent Core decides:
  "What context is needed?"
  "Which capability should handle this?"
  "Which model/tool/agent is eligible?"
  "What action is safe?"
  "Does it require approval?"
  "Did execution succeed?"
  "Should we retry, fall back, escalate or stop?"
```

The user should not need to manually choose between Cursor, Codex, Hermes, Playwright, a model, an MCP server, or a deterministic tool for routine cases.

That routing knowledge belongs in the platform.

---

## 22. Architectural position

Agent Core v1 established the shared Jev platform.

Agent Core v2 turns that foundation into a reusable **AI Control Plane**:

```text
Jev = fast structured decision layer
Frontier LLM = deep reasoning layer
Deterministic runtime = execution layer
Policy engine = authority layer
Context Governor = memory/relevance layer
Supervisor = workflow coordination layer
Playwright MCP = controlled browser execution layer
Agent Core = orchestration/control plane
Human = final authority for high-risk actions
```

This document is the design target for v2 implementation and should be treated as the primary blueprint for subsequent engineering phases.