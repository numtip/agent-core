# Security hardening — runtime (October 2026)

Branch `fix/security-runtime-hardening`, based on `main` `e876511`. It contains the five
audit fixes from `27d77c8` plus the remediation below. Production (`releases/dbe20a5`) is
**not** changed by this branch. Deployment needs a separate, approved release.

## Defects and fixes

| # | Defect (baseline `dbe20a5` / `main`) | Fix | Regression tests |
|---|---|---|---|
| 1 | `x-agent-project: constructor` / `__proto__` → HTTP 500 | Own-property key lookup | `audit-fixes.test.ts` |
| 2 | Malformed `AGENT_CORE_PROJECT_KEYS` crash printed every token to the log | Sanitised parse error; Fastify log redaction for credential headers | `audit-fixes.test.ts`, `secret-redaction.test.ts` |
| 3 | Any `route` project could complete another project's subgoal | Key must start with the caller's project | `audit-fixes.test.ts` |
| 4 | SSRF guard was lexical only and missed CGNAT, 0/8, benchmark, multicast, NAT64, 6to4, IPv4-compatible IPv6 | `net-guard.ts`: `BlockList` of all non-global ranges; DNS pre-resolution, where any private answer or a DNS failure means DENY | `ssrf-egress.test.ts` |
| 5 | Redirect or rebinding to an internal host was returned to the caller | Final `Page URL` re-checked (lexical + allow/deny + DNS); on failure the tab is blanked and content withheld; a missing final URL means DENY | `v2-browser-execute.test.ts` |
| 6 | Redirects, subresources, page `fetch()` and DNS rebinding bypass any app-level check | `egress-proxy.ts`: loopback-only proxy that resolves DNS itself, allows public addresses on ports 80/443 only, and connects to the checked IP | `ssrf-egress.test.ts`, live E1–E5 |
| 7 | `BROWSER_INPUT` navigated before refusing a missing `element_ref` | Validation runs before any side effect | `v2-browser-execute.test.ts` |
| 8 | `BROWSER_INPUT` could never work: one MCP session per tool call on an `--isolated` server | `McpSession`: navigate → snapshot → type in one session, closed in `finally` | live S1–S4, A6 |
| 9 | `browser_type` sent `ref`; the installed MCP requires `target` | Send `target` (and `ref` for older servers); `element_ref` limited to snapshot-ref syntax; the ref must exist in the verified page snapshot | `v2-browser-execute.test.ts`, live A6–A7 |
| 10 | `/control` and `/v1/control-metrics` were unauthenticated at the origin | `controlGuard`: a project token with `metrics` scope, or a verified Cloudflare Access JWT (RS256, JWKS, iss/aud/exp/nbf). Unconfigured → 503; anything else → 401 | `control-auth.test.ts`, live A4 |
| 11 | Navigation/tool errors were reported as `EXECUTED` | `TOOL_ERROR`, `executed:false` | `v2-browser-execute.test.ts` |

API behaviour changes for callers:

- `BROWSER_READ` now returns the inline page snapshot (with `[ref=…]`) in `result.text`.
- `BROWSER_INPUT` needs a snapshot ref (for example `e12`); CSS/text selectors are rejected with 400.

## Evidence

| Check | Baseline (`main`) | This branch |
|---|---|---|
| `tsc --noEmit` | clean | clean |
| `vitest run` | 109 passed, 1 skipped | 224 passed, 1 skipped |
| New tests that fail on the old code | — | 15/15 (fixes 1–5, 7) |
| Live QA (`ops/v2-browser-hardening-qa.mjs`) | n/a | 16/16 PASS — [`evidence/security-hardening/`](evidence/security-hardening/) |
| `npm audit --omit=dev` | 0 | 0 |
| Secret scan of diff + evidence | — | 0 token-like strings, keys, account IDs or fingerprints |

The live QA starts its own page server, egress proxy, two `--isolated` Playwright MCP instances
and the built app on ports 18080–18793. All credentials are synthetic, and it refuses to run if a
port is already in use. It never touches the production runtime.

## Known limitations

- **Egress proxy is not deployed yet.** Until the browser MCP runs with
  `--proxy-server http://127.0.0.1:8792`, protection against redirects, subresources and rebinding
  relies on the app-level checks (fixes 4 and 5) and the existing `--blocked-origins` list. A
  blind GET via redirect to a LAN host remains possible without the proxy.
- The app-level DNS check and Chromium resolve separately, so a short rebinding window exists
  without the proxy. The proxy closes it by pinning the checked IP.
- The proxy allows only ports 80/443 and does not proxy WebSocket upgrades over plain HTTP.
- `vitest` (dev only) has 3 advisories; the fix is a major upgrade (`vitest@5`) and is not done here.
- `/v1/projects` still lists the whole project registry to any `metrics`-scoped project (by design).

## Release readiness checklist (future deploy)

- [ ] PR reviewed and approved by Prinya; merged to `main`
- [ ] Release built from the merge commit; `tsc` + `vitest` green on the release tree
- [ ] `AGENT_CORE_CF_ACCESS_TEAM_DOMAIN` and `AGENT_CORE_CF_ACCESS_AUD` (AUD tag of the existing
      control-plane Access application) added to the env file — **without them `/control` returns 503**
- [ ] Egress proxy unit installed (`deploy/systemd/agent-core-egress-proxy.service`, loopback 8792)
- [ ] Browser MCP started with `--proxy-server http://127.0.0.1:8792` (keep `--isolated`, `--blocked-origins`)
- [ ] Callers using `BROWSER_INPUT` updated to pass snapshot refs taken from a `BROWSER_READ`
- [ ] Isolated QA on the release tree: `npm run qa:browser-hardening` → all PASS
- [ ] After switch: `/v1/health` 200; `/control` via Access 200; `/control` direct to origin without credentials 401
- [ ] Rollback rehearsed (below)

## Rollback

Nothing in this branch changes data or credentials, so rollback means switching the release symlink back:

```bash
ln -sfn releases/dbe20a5 ~/agent-core/current     # previous release
systemctl --user restart agent-core.service
curl -s http://127.0.0.1:8787/v1/health
# If the browser MCP was changed: drop --proxy-server from its unit, then
systemctl --user daemon-reload && systemctl --user restart agent-core-browser-mcp.service
systemctl --user disable --now agent-core-egress-proxy.service   # if installed
```

The new env variables (`AGENT_CORE_CF_ACCESS_*`, `AGENT_CORE_CONTROL_AUTH`) are ignored by `dbe20a5`
and can stay in place.
