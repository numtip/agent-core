# Security Baseline

## Trust model

Agent Core uses defense in depth. No AI model is treated as a security boundary.

## Mandatory controls

1. The runtime must not expose its application port directly to the public Internet.
2. External access should enter through Cloudflare Tunnel.
3. Each project must use a distinct machine identity or credential.
4. Application authorization must be enforced after Cloudflare authentication.
5. OpenRouter/provider secrets live only in the protected runtime environment.
6. Secrets must never be committed to Git.
7. Destructive and production actions require explicit policy and, where defined, human approval.
8. Inputs and AI outputs must be schema validated.
9. Important decisions and resulting actions must be auditable.
10. Provider/model failure must fail safely.

## Hard-policy examples

The following should normally be denied from AI-mediated content access unless an explicit secure workflow permits them:

- `.env` and variants
- SSH private keys
- API tokens
- credential stores
- private certificates
- raw secrets
- unrelated personal/sensitive data

Examples:

```text
git status           -> normally ALLOW
unit tests           -> normally ALLOW
read project source  -> policy-controlled ALLOW
git push             -> ASK / project policy
production deploy    -> HUMAN APPROVAL
database write       -> elevated policy / approval
secret-file access   -> DENY by default
```

## Cloudflare

Recommended controls:

- Tunnel
- Access service identity
- WAF
- endpoint/project rate limits
- TLS
- optional API Shield after v1
- optional mTLS for higher-assurance machine clients later

## Origin

Recommended binding:

```text
127.0.0.1:<agent-core-port>
```

The VPS firewall should not expose that port publicly.

## Logging

Do not log:

- bearer tokens
- provider API keys
- secret values
- raw sensitive payloads unless an explicit redaction and retention policy exists

Prefer hashes/IDs and structured metadata.

## Security precedence

```text
Hard policy > authorization > Jev recommendation > runtime action
```

A Jev recommendation can never override a hard deny or required human approval.

## Browser egress and control plane

- Browser targets must resolve only to globally routable addresses (`src/net-guard.ts`); DNS
  failure, private answers and unverifiable final URLs are denied.
- The browser MCP should run behind the egress proxy (`src/egress-proxy.ts`), which pins the
  checked IP so redirects, subresources and DNS rebinding cannot reach internal hosts.
- `/control` and `/v1/control-metrics` require a verified Cloudflare Access assertion or a
  `metrics`-scoped project token at the origin; misconfiguration fails closed.

Details, evidence and the release checklist: `docs/SECURITY_HARDENING_2026-10.md`.
