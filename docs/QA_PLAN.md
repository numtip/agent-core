# Agent Core QA Plan

## Automated gates

- TypeScript build
- Unit tests
- Jev response parsing tests
- confidence/fallback tests
- authentication tests
- cross-project isolation tests
- hard-policy tests
- context-selection tests
- advanced-routing tests
- subgoal-deduplication tests

## Deployment QA

After VPS/Cloudflare credentials are available:

1. `GET /v1/health` from VPS loopback returns 200.
2. Cloudflare hostname returns health through Tunnel.
3. Port 8787 is unreachable directly from outside the VPS.
4. Protected machine API without credentials returns 401.
5. Invalid token returns 401.
6. Valid token with wrong scope returns 403.
7. Cross-project body/header mismatch returns 403.
8. Valid Jev request reaches OpenRouter Decisions API.
9. Provider outage triggers safe fallback or 503 when no fallback exists.
10. Rate limit returns 429 after configured threshold.
11. Audit log contains no bearer/project/OpenRouter secrets.
12. Control Center is reachable only through Cloudflare Access.

## Pilot QA — 52Clips

Pilot only `NEXT_ACTION`, `QA_DISPOSITION`, and `SUBAGENT_ROUTE` first. Compare Jev decisions with existing production state before allowing automatic progression.

## Release rule

A release is not production-ready merely because repository CI passes. Production readiness additionally requires successful live smoke QA through the configured Cloudflare/VPS path.