# Phases 2–8 Implementation

## Phase 2 — VPS + Cloudflare

Implemented repository-side production packaging: Docker, Compose, systemd unit, Cloudflare Tunnel template, project authentication, scope authorization, per-project rate limits, audit log and activation runbook.

## Phase 3 — 52Clips Pilot

`adapters/52clips/jev.yaml` enables the initial bounded pilot decisions: `NEXT_ACTION`, `QA_DISPOSITION`, and `SUBAGENT_ROUTE`. Live activation is gated on access to the project runtime and production Agent Core endpoint.

## Phase 4 — Shared Client

`src/cli.ts` exposes `health`, `doctor`, `decision`, `route`, and `qa` against a shared Agent Core endpoint.

## Phase 5 — Existing Projects

Adapters exist for all current target projects with a deliberately stricter read-only default for dbplant.

## Phase 6 — Context Intelligence

`/v1/context` performs bounded deterministic candidate selection and ranking rather than whole-repository ingestion. This v1 design intentionally filters before any optional future semantic/Jev reranking to control cost and latency.

## Phase 7 — Advanced Routing

`/v1/advanced-route` applies hard policy first, then sensitivity/complexity/cost routing. Subagent plans use active-subgoal deduplication.

## Phase 8 — Control Center

`/control` and `/v1/control-metrics` provide a small private operational surface intended to sit behind Cloudflare Access. Machine endpoints continue to use project identity and scopes.