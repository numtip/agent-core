# Hermes / Groq — VPS 237 isolated staging preflight

**Status:** GOVERNANCE READY · **activation NOT approved until ADR 0002 signed**  
**Host:** `10.1.254.237` · **Baseline:** `41195f6`  
**Production:** `~/agent-core/current` → `8787` · **Staging target:** `127.0.0.1:8788` (loopback only)

**Live evidence (2026-10-21, read-only):** prod release `dbe20a5`, API `0.7.0`, `AGENT_CORE_ENV=production`, `/v2/inference/*` on `:8787` → **404**, `:8788` free, `GROQ_*` absent from prod env.

## Purpose

Read-only preflight and approval checklist before **isolated Groq inference staging** on VPS 237. Complements ADR 0001 (production NO-GO) and draft ADR 0002 (owner exception).

## Scope

| In scope | Out of scope |
|----------|----------------|
| Loopback staging on `:8788` | Production `8787`, `current` symlink, prod env |
| Read-only Hermes context | Hermes memory writes, gateway config changes |
| Groq `/v2/inference/*` | `/v1/decision` provider swap, Cloudflare edits |
| Owner-approved spend cap | Credential transfer via chat, git, or email |

## Prerequisites (read-only gates)

Run on `10.1.254.237` as `prinyaroot`. **Do not restart services** during preflight.

```bash
# Identity
hostname; ip -4 addr show ens160 | rg 'inet '

# Production unchanged
readlink -f ~/agent-core/current
curl -sS http://127.0.0.1:8787/v1/health | jq -r '.version, .auth_required'
curl -sS -o /dev/null -w 'inference_on_prod=%{http_code}\n' http://127.0.0.1:8787/v2/inference/budget

# Port 8788 free
ss -tln | rg ':8788 ' && echo FAIL || echo '8788 free'

# Egress (no secrets)
curl -sS -o /dev/null -w 'groq=%{http_code}\n' https://api.groq.com/openai/v1/models
curl -sS -o /dev/null -w 'openrouter=%{http_code}\n' https://openrouter.ai/api/v1/models

# Prod env must stay production without GROQ_*
stat -c '%a %n' ~/.config/agent-core/agent-core.env
rg '^AGENT_CORE_ENV=' ~/.config/agent-core/agent-core.env
rg '^GROQ_' ~/.config/agent-core/agent-core.env && echo 'UNEXPECTED GROQ in prod env' || echo 'no GROQ in prod env'
```

**Pass criteria:** prod health `200`, inference on `8787` → `404`, `8788` free, Groq TLS → `401`, prod env `600`, `AGENT_CORE_ENV=production`, no `GROQ_*` in prod env.

## Orphan listeners `18881–18888` (2026-10-21 audit)

| Port | PID | Started (UTC+7) | CWD | Command | systemd slice |
|------|-----|-----------------|-----|---------|---------------|
| 18881 | 3034793 | 2026-10-12 15:30:14 | `~/agent-workspace/agent-core-j2c9b` | `node dist/src/server.js` | `hermes-gateway.service` cgroup |
| 18882 | 3034830 | 2026-10-12 15:30:15 | same | same | same |
| 18883 | 3034928 | 2026-10-12 15:30:22 | same | same | same |
| 18884 | 3034961 | 2026-10-12 15:30:23 | same | same | same |
| 18885 | 3035007 | 2026-10-12 15:30:24 | same | same | same |
| 18886 | 3035041 | 2026-10-12 15:30:25 | same | same | same |
| 18887 | 3035100 | 2026-10-12 15:30:25 | same | same | same |
| 18888 | 3035163 | 2026-10-12 15:30:26 | same | same | same |

**Dependencies / ownership**

- Source tree: J2-C9C isolated worktree `agent-core-j2c9b` @ `dbe20a5` (uncommitted Jev patch); **not** production release.
- Parent PID: `systemd --user` (1540) — long-lived scratch servers, **not** `agent-core.service`.
- **Not** registered as user units; shared cgroup with `hermes-gateway.service` (Hermes main PID 3872090; `TasksCurrent` includes these Node processes).
- Observed: `http://127.0.0.1:18881/v1/health` → `auth_required: false` (**auth drift** vs prod).

**Activation gate (before staging Groq):** document plan to stop these eight processes in the **activation** runbook only after owner approval — preflight **does not** kill them. Staging must not start until either (a) ports `18881–18888` are clear, or (b) owner accepts documented risk and confirms **only one** inference ledger writer (staging on `8788` must not run concurrently with any other `/v2/inference` instance).

## Isolation contract (staging)

| Control | Requirement |
|---------|-------------|
| Release | `~/agent-core/releases/<sha>/` at ≥ `41195f6`; prod `current` untouched |
| Bind | `AGENT_CORE_HOST=127.0.0.1`, `AGENT_CORE_PORT=8788` |
| Runtime env | `AGENT_CORE_ENV=development` (or `test`) |
| Env file | `~/.config/agent-core/agent-core-groq-staging.env` (`600`) |
| Auth | `AGENT_CORE_AUTH_REQUIRED=true`; dedicated staging token |
| Scopes | One project, `["inference"]` only |
| Groq | `GROQ_ENABLED=true`, key only in staging env |
| Fallback | `GROQ_FALLBACK_OPENROUTER=false` unless separate staging OpenRouter key |
| Ledger | `GROQ_COST_LEDGER=~/agent-core/logs/groq-staging-v237/groq-cost-ledger.json` |
| Audit | `AGENT_CORE_AUDIT_LOG=~/agent-core/logs/groq-staging-v237/audit.jsonl` |
| Processes | **One** staging Node for inference |
| Hermes | Read-only MCP / memory search only |

## Resource thresholds (do not activate if failed)

| Metric | Threshold | Action if exceeded |
|--------|-----------|-------------------|
| Disk free on `/` | ≥ **5 GiB** | Defer activation; cleanup logs/backups first |
| Mem `available` | ≥ **1.5 GiB** sustained | Defer or set staging `MemoryMax=512M` |
| Staging RSS | ≤ **512 MiB** steady-state | Investigate leaks; stop staging |
| Prod `8787` latency | health p95 ≤ **2 s** during staging QA | Pause staging load test |
| Monthly estimated spend | ≤ **`GROQ_MONTHLY_BUDGET_USD`** | Stop; owner review |

## Redaction rules

- Never print `GROQ_API_KEY`, project tokens, or `Authorization` headers in QA artifacts.
- Audit review: `rg -cE '[0-9a-f]{64}' ~/agent-core/logs/groq-staging-v237/audit.jsonl` → **0**.
- Logs: only token counts, `estimated_cost_usd`, `task_id`, HTTP status — per ADR 0001.

## QA gates (must pass before activation)

1. **Governance:** ADR 0002 signed; monthly cap recorded.
2. **Preflight script:** all commands in §Prerequisites pass.
3. **Build gate:** `npm test` + `npm run build` on staged SHA (in release dir, not prod).
4. **Staging smoke (post-activation):** `GET /v2/inference/budget` with staging token → `200`; prod `8787` inference still `404`.
5. **Negative auth:** missing/wrong token → `401`; project without `inference` scope → `403`.
6. **Budget:** one minimal `POST /v2/inference/complete` → audit row, ledger updated, no secret leakage.
7. **Prod non-regression:** `curl http://127.0.0.1:8787/v1/health` unchanged; `agent-core.service` active throughout.
8. **Hermes:** read-only tool invocation only; no write actions in pilot window.

## Activation approval checklist (owner)

- [ ] ADR 0002 approver line signed
- [ ] Staging env file path agreed (`agent-core-groq-staging.env`)
- [ ] Groq key provisioned **directly on host** (not via repo/chat)
- [ ] OpenRouter fallback **disabled** OR separate staging OpenRouter key documented
- [ ] Orphan `18881–18888` remediation plan accepted
- [ ] Spend cap USD: _______
- [ ] Review / teardown date: _______
- [ ] Explicit **NO** change to Cloudflare / prod env / `current` symlink

## Rollback (staging only)

See `docs/runbooks/GROQ_VPS_237_ISOLATED_STAGING.md` §Rollback. Production rollback remains `docs/V2_ROLLBACK_RUNBOOK.md` (unaffected).

## References

- ADR 0001 — `docs/adr/0001-groq-inference-pilot.md`
- ADR 0002 (draft) — `docs/adr/0002-groq-vps237-isolated-staging-exception.md`
- Hermes read-only — `docs/pilots/HERMES_READONLY_INFERENCE_PILOT.md`
- Groq integration — `docs/integrations/GROQ_INFERENCE_PILOT.md`
- J2-C9C evidence — VPS `~/agent-core/logs/activation-dbe20a5/J2C9C-ISOLATED-VALIDATION.md`
