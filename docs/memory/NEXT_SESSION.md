# Next session — resume guide

**Start from:** `git fetch origin && git checkout main && git pull` (written at closeout with `main` = `41195f6`).

**Closeout 2026-10-21:** PR #38 merged (Groq pilot on `main`). VPS has **isolated staging** on `:8788` only — **not** production Groq. Hermes skill integrated (CONTEXT_ONLY). PR #39 governance **open**. Do not treat staging as production activation.

## Immediate next steps

1. **Merge PR #39** (or revise ADR 0002) if owner wants governance docs on `main`.
2. **Obsidian:** paste [OBSIDIAN_HANDOFF_2026-10-21.md](./OBSIDIAN_HANDOFF_2026-10-21.md) into vault per MEMORY_CONTRACT (manual).
3. **Optional VPS:** remediate orphan listeners `18881–18888` only with owner approval (not required for staging ledger).

## Verify before any deploy

```bash
readlink -f ~/agent-core/current          # expect dbe20a5 for production
curl -sS -m 3 http://127.0.0.1:8787/v1/health
curl -sS -m 3 http://127.0.0.1:8788/v1/health   # staging only
systemctl --user is-active agent-core.service agent-core-groq-staging.service
```

Production pointer unchanged: `releases/dbe20a5`, SHA `dbe20a5543c07996aafc9f39ceb050007ce79842`, `"version":"0.7.0"`.

## Groq staging (local dev or VPS pilot)

- Scope: project with `inference` only; `GROQ_FALLBACK_OPENROUTER=false` unless separate staging OpenRouter key.
- Hermes: run skill script or `hermes -z ... --skills agent-core-groq-inference` (terminal only); no memory writes from model output.

## Priorities (unchanged from 2026-10-14 where still open)

- Cursor live activation / credentials — see [2026-10-14.md](./2026-10-14.md) if still blocked.
- Token rotation: **DEFERRED** by owner — do not rotate from docs work alone.
