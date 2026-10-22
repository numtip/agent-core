# ADR 0002 (DRAFT): VPS 237 isolated Groq staging — owner exception to ADR 0001

**Status:** DRAFT — **requires explicit owner approval (Prinya) before any activation**  
**Date:** 2026-10-21  
**Host:** `10.1.254.237` (`ubantu24`)  
**Baseline code:** `41195f6` (or later merge containing Groq inference pilot)  
**Supersedes:** nothing — **ADR 0001 remains authoritative for production**  
**See also:** [ADR 0001](./0001-groq-inference-pilot.md) · [Preflight](../pilots/HERMES_VPS_237_ISOLATED_STAGING_PREFLIGHT.md) · [Runbook](../runbooks/GROQ_VPS_237_ISOLATED_STAGING.md)

## Relationship to ADR 0001

| ADR 0001 rule | Production (`agent-core.service`, `:8787`) | This exception (staging only) |
|---------------|--------------------------------------------|-------------------------------|
| Groq inference on VPS | **BLOCKED / NO-GO** | **Allowed only** under the isolation contract below |
| `AGENT_CORE_ENV=production` blocks `/v2/inference/*` | **Unchanged — stays production** | Staging **must** use `development` or `test` only |
| File ledger not multi-instance safe | Prod **must not** mount inference routes | **Exactly one** staging inference process; **dedicated ledger path** |
| Jev on OpenRouter | **Unchanged** | **Unchanged** — staging must not alter `/v1/*` on prod |
| OpenRouter chat fallback | N/A on prod (no inference) | **Default OFF**; ON only with a **separate staging OpenRouter credential** |

**Production NO-GO is preserved.** This ADR does not authorize repointing `~/agent-core/current`, editing `~/.config/agent-core/agent-core.env`, Cloudflare changes, or enabling inference on port `8787`.

## Context

- Groq pilot code and ADR 0001 landed at `41195f6`; live VPS release remains `dbe20a5` without `/v2/inference/*`.
- Owner needs **read-only Hermes context + bounded Groq chat** on the same host **without** production activation.
- Prior isolated QA (J2-C9C) demonstrated loopback scratch instances; eight leftover listeners on `18881–18888` increase multi-instance and auth-drift risk.

## Decision (exception scope)

Approve **one** optional, **loopback-only** staging plane:

1. **Separate release tree** — e.g. `~/agent-core/releases/<41195f6-sha>/` built from approved SHA; **never** symlink `current` for staging.
2. **Loopback bind** — `127.0.0.1:8788` only (no `0.0.0.0`, no Cloudflare ingress).
3. **Separate environment file** — `~/.config/agent-core/agent-core-groq-staging.env` mode `600`, not sourced by production unit.
4. **Staging-only project identity** — e.g. project id `groq-staging-v237` with scopes **`["inference"]` only** (no `decision`/`route`/`qa` unless explicitly re-approved).
5. **Isolated Groq secret** — `GROQ_API_KEY` only in staging env; never copied into prod env or git.
6. **Isolated audit + ledger** — distinct `AGENT_CORE_AUDIT_LOG` and `GROQ_COST_LEDGER` under `~/agent-core/logs/groq-staging-v237/` (mode `700` dir, `600` files).
7. **Single inference process** — at most one Node process serving `/v2/inference/*` on the host; preflight must prove no second ledger writer (see orphan port gate).
8. **OpenRouter fallback** — `GROQ_FALLBACK_OPENROUTER=false` unless a **dedicated** staging OpenRouter key is provisioned (`OPENROUTER_API_KEY` in staging env only, rate-limited separately).
9. **Hermes** — read-only tools only per `docs/pilots/HERMES_READONLY_INFERENCE_PILOT.md`; no memory writes from pilot workers.
10. **Spend cap** — `GROQ_MONTHLY_BUDGET_USD` default **10** (owner may lower); treat ledger overspend block as **stop work**, not auto-raise.

## Non-goals (explicit)

- Production deploy, restart, or env mutation for `agent-core.service`
- Merging Groq into the live `8787` process
- Using production OpenRouter key for Groq fallback
- Public exposure of staging API
- Automatic execution of model output on the host or in git

## Approval record (fill on sign-off)

| Field | Value |
|-------|--------|
| Approver | __________________ |
| Date | __________________ |
| Approved monthly cap (USD) | __________________ |
| Fallback allowed (Y/N) | __________________ |
| Max staging lifetime / review date | __________________ |

## Consequences

- Enables bounded VPS validation of Groq inference under file-ledger constraints **only** while ADR 0001 production block stands.
- Accepts **residual risk**: file ledger remains non-distributed; exception is void if a second inference instance runs concurrently.
- Requires periodic re-validation or revocation if spend, orphans, or prod drift appear.

## Alternatives rejected

- Waiving ADR 0001 production block — rejected; production stays NO-GO.
- Shared ledger with prod — rejected (race / overspend).
- `GROQ_PILOT_ACTIVATION` override on production env — rejected.
