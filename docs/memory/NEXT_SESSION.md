# Next session — resume guide

**Start from:** `git fetch origin && git checkout main && git pull`.

**Closeout 2026-10-21 evening:** Live production is `releases/5ae20af` on `:8787`. GitHub `main` at verification was `37694cb` (docs describing that deploy). Staging `:8788` runs the same tree with an isolated env. Hermes can call production Jev and staging fast/reasoning/frontier. Production inference stays closed.

## Immediate next steps

1. Do not enable production inference without a separate approval. Required gates: an `inference` scope, a non-production env or an explicit pilot change, and provider flags. None of those were changed at closeout.
2. **Merge PR #39** (or revise ADR 0002) only if the owner wants that governance draft on `main`.
3. **Obsidian:** paste [OBSIDIAN_HANDOFF_2026-10-21.md](./OBSIDIAN_HANDOFF_2026-10-21.md) manually. This closeout did not write the vault.
4. Optional: orphan listeners `18881–18888` only with owner approval.

## Verify before any deploy

```bash
readlink -f ~/agent-core/current          # expect releases/5ae20af
curl -sS -m 3 http://127.0.0.1:8787/v1/health   # groq_inference_enabled false
curl -sS -m 3 http://127.0.0.1:8788/v1/health   # staging, groq_inference_enabled true
systemctl --user is-active agent-core.service agent-core-groq-staging.service hermes-gateway.service
```

Production SHA `5ae20af0fe86a5974d95844aa9b706d464f61f8e`, `"version":"0.7.0"`. Staging rollback is the unit backup `~/agent-core/backups/staging-multiprovider-20261021-222924/` plus release `41195f6`. Restart only `agent-core-groq-staging.service` to roll staging back.

## Hermes

- Jev: `~/.hermes/skills/integrations/agent-core-jev-decision/scripts/decision.py` — one read-only `NEXT_ACTION`. Token is read from the mode-600 production env. Do not print it.
- Inference: `~/.hermes/skills/integrations/agent-core-groq-inference/scripts/inference_complete.py --task fast|reasoning|frontier`. Staging only. No memory writes from model output.

## Priorities still open

- Cursor live activation / credentials — see [2026-10-14.md](./2026-10-14.md) if still blocked.
- Token rotation: **DEFERRED** by owner — do not rotate from docs work alone.
- Production Jev timeout remains 8000 ms.
