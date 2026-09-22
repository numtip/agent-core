# Deployment Activation Runbook

## Target

`Project -> Cloudflare Access/WAF -> Tunnel -> 127.0.0.1:8787 -> Agent Core -> OpenRouter/Jev`

## Required secrets

- `OPENROUTER_API_KEY` on VPS only
- Cloudflare Tunnel credential on VPS only
- Cloudflare Access service credentials per calling project
- `AGENT_CORE_PROJECT_KEYS` project tokens or an equivalent secret-store injection

No secret belongs in Git.

## VPS

1. Create dedicated `agentcore` service account.
2. Install Node 22+ or Docker.
3. Deploy repository to `/opt/agent-core/releases/<version>`.
4. Create protected environment file under `/etc/agent-core/` or `.env` for Compose.
5. Bind Agent Core to `127.0.0.1:8787` only.
6. Start service and verify `GET /v1/health` locally.
7. Install `cloudflared` and configure the example tunnel.
8. Confirm the VPS firewall does not expose port 8787 publicly.

## Cloudflare

1. Create DNS hostname such as `agent.<domain>` backed by Tunnel.
2. Protect the application with Cloudflare Access.
3. Create separate service credentials for each project.
4. Add WAF/rate limits appropriate to the API.
5. Verify direct-origin access is impossible.

## Application credentials

`AGENT_CORE_PROJECT_KEYS` is a JSON object, for example:

```text
{"52clips":"<secret>","goffice2026":"<secret>"}
```

`AGENT_CORE_PROJECT_SCOPES` may narrow each identity:

```text
{"52clips":["decision","route","qa","context","metrics"],"dbplant":["decision","context"]}
```

## Smoke QA

- Local health returns 200.
- Unauthenticated protected request returns 401.
- Wrong-project request returns 403.
- Valid project decision reaches Jev or declared fallback.
- Rate limit produces 429 when exceeded.
- Audit JSONL contains metadata but no tokens.
- `/control` is accessible only through authenticated policy.

## Current activation dependency

Actual production activation requires authorized Cloudflare and VPS credentials. Repository readiness alone does not assert that production is live.