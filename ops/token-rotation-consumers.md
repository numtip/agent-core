# Token rotation — consumer update instructions

Companion to `ops/rotate-project-tokens.py`. Read this before rotating: rotation has **no overlap
window** (`src/auth.ts` compares a single token string with `timingSafeEqual`), so every consumer of
a rotated identity returns `401 UNAUTHORIZED` from the moment the service restarts until it is given
the new token.

A local scan of the development workspace found **one** confirmed consumer. Everything else is
marked UNKNOWN rather than guessed: an invented location is worse than an honest gap, because a
fleet rotation silently breaks whoever the guess missed.

## Identities

| Identity | Confirmed consumer | Credential source | Update method | Owner |
|---|---|---|---|---|
| `rae-attendance-v2` | **none found locally** | — | — | UNKNOWN |
| `attendance-report-generator` | `CodexWorker` (Node ESM: `agent_core_client.mjs`, `jev_qa_gate.mjs`, `browser_preflight.mjs`) | env vars `AGENT_CORE_PROJECT_TOKEN`, `AGENT_CORE_PROJECT`, `AGENT_CORE_URL` | set the env var in the runner that executes those scripts, then re-run `jev_qa_gate.mjs` | UNKNOWN |
| `goffice2026` | **none found locally** | — | — | UNKNOWN |
| `handbook` | **none found locally** | — | — | UNKNOWN |
| `dbplant` | **none found locally** | — | — | UNKNOWN |
| `52clips` | **not present in the local workspace** | UNKNOWN | UNKNOWN — must be traced on the VPS | UNKNOWN |

`rae-attendance-v2`, `goffice2026`, `handbook` and `dbplant` have Agent Core **config placeholders**
in their repos (`AGENTS.md`, `.env.example`) but no runtime that reads a token, so they need no
update until someone wires one up.

## UNKNOWN holders — resolve these before a fleet rotation

1. Any CI job, cron entry, systemd unit or webhook that carries `x-agent-project-token`.
2. Any machine that received a token through `ops/handoff-project-token.py`. The handoff writes to
   a destination path on a target host; that path is the record of a holder, so enumerate handoff
   destinations rather than relying on memory.
3. `52clips`, which is registered in production but has no local presence at all.
4. The `agent-core` project profile itself (present on `main` only), once it is given a token.

Recommended on the VPS before rotating:

```bash
# every service that could carry the header, plus any env file that mentions the keys var
systemctl --user list-units --type=service --all
grep -rl "AGENT_CORE_PROJECT_KEYS" ~/.config 2>/dev/null
```

`ops/handoff-project-token.py --verify-only --dest <path>` re-reads only metadata and a sha256 prefix
on the target, so it is safe to inventory holders without exposing a value.

## Safe rotation order

1. Resolve the UNKNOWN holders above. Decide the blast radius: prefer
   `--only <identity>` over the fleet-wide default.
2. Announce a window per identity. There is no way to rotate without a short outage.
3. Rotate with an encrypted backup and a smoke test:

   ```bash
   python3 ops/rotate-project-tokens.py --only rae-attendance-v2 \
       --backup-recipient <age-or-gpg-recipient> \
       --base-url https://agent.raemanagemju.net --apply
   ```

   Exit codes: `0` ok · `2` the env file changed but the service is not confirmed active ·
   `3` the new token was not accepted · `4` refused before writing anything.
4. Distribute the new token to each consumer out of band. Never in a repo, a chat, or a log.
5. Confirm each consumer: the pre-rotation token must now return `401`, the new one `200`.
6. Keep the encrypted backup until every consumer is confirmed.

## Recovering

- **Interrupted restart** (exit `2`): the env file is already rotated. Either
  `--rollback <backup>` to restore the previous tokens, or fix the cause and run
  `--restart-only` to finish without rotating again.
- **A consumer was missed** (exit `3`, or a `401` report): roll back, then retry with a wider
  window. Do not "just rotate again" — that invalidates the tokens you already distributed.

## Verification recipe

```bash
python3 ops/rotate-project-tokens.py --smoke --only <identity> \
    --base-url https://agent.raemanagemju.net
```

A stale token must return `401`; an accepted one returns a JSON body with a `disposition`. An
**HTML** body means Cloudflare Access refused the request before it reached the app, which is a
different problem from a bad token.
