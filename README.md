# Agent Core

Shared AI Decision Infrastructure for current and future projects.

## Purpose

Agent Core is a reusable control plane for AI-assisted projects. Projects do **not** call Jev directly. They call the Agent Core API, which applies policy, context selection, routing, validation, audit logging, and fallback before invoking Jev or another execution path.

## Target architecture

```text
Project / Cursor / Codex / CLI
              |
            HTTPS
              |
         Cloudflare
   Access / WAF / Tunnel
              |
              v
       Agent Core on VPS
   Policy / State / Context
     Routing / QA / Audit
        |            |
        v            v
       Jev       Frontier LLM
    OpenRouter      / Tools
```

## Responsibilities

- **GitHub** — source of truth, versioning, CI/CD, documentation
- **Cloudflare** — ingress, identity, WAF, rate limits, tunnel
- **VPS** — runtime for Agent Core
- **OpenRouter / Jev** — bounded decision engine
- **Frontier LLMs** — complex reasoning and generation
- **Deterministic code** — validation, execution, build, tests, Git, media/data processing
- **Human** — irreversible and production approvals

## Core decision types

- `TASK_ROUTE`
- `CONTEXT_ROUTE`
- `TOOL_ROUTE`
- `MODEL_ROUTE`
- `SUBAGENT_ROUTE`
- `NEXT_ACTION`
- `QA_DISPOSITION`
- `HUMAN_ESCALATION`

## Principles

1. Deterministic first.
2. Jev for bounded decisions.
3. Frontier models for reasoning.
4. Explicit state over transcript.
5. Minimal task-specific context over whole-repo context.
6. Schema over prose.
7. Security policy overrides AI decisions.
8. Every important decision is auditable.
9. Fallback is mandatory.
10. One shared core; adapters per project.

## Platform status (verified labels)

Use these terms in docs and runbooks:

| Label | Meaning |
|-------|---------|
| **IMPLEMENTED** | Merged on `main`, tests/CI green |
| **DEPLOYED** | Built release on VPS (may lag `main`) |
| **ACTIVATED** | Live credentials, scopes, and endpoints in use |
| **VERIFIED** | Fresh QA or audit evidence for the claimed SHA/runtime |

**Source (GitHub `main`):** package `0.7.0`, plus commits after the deployed SHA (knowledge observation/memory and local REA handoff routing).  
**Production (verified 2026-10-13 on the VPS):** release `dbe20a5`, package `0.7.0`, **8** capabilities, **6** project identities. Rollback directory `01092e2`. Details in [docs/STATUS.md](docs/STATUS.md).  
**Activated:** `rae-attendance-v2` with scope `decision` only.  
**Not deployed:** observation/memory capabilities, `mcp.rea`, `POST /v2/rea/route`. OpenWiki live transport is not activated.

See:
- [docs/STATUS.md](docs/STATUS.md) — authoritative platform matrix
- [docs/memory/CURRENT_STATE.md](docs/memory/CURRENT_STATE.md) · [docs/memory/NEXT_SESSION.md](docs/memory/NEXT_SESSION.md) — project handoff
- [docs/audits/AGENT_CORE_REALITY_AUDIT_20261013.md](docs/audits/AGENT_CORE_REALITY_AUDIT_20261013.md) — latest read-only audit
- [BLUEPRINT.md](BLUEPRINT.md) · [ARCHITECTURE.md](ARCHITECTURE.md) · [SECURITY.md](SECURITY.md)
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) · [schemas/openapi.yaml](schemas/openapi.yaml)

## Initial project migration order

1. 52Clips — pilot
2. attendance-report-generator
3. handbook
4. goffice2026
5. dbplant

## Secrets

Never commit API keys, tokens, credentials, SSH keys, certificates, or production secrets. Copy `.env.example` locally and inject real secrets on the VPS or through an approved secret store.
