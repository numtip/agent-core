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

   Exit codes:

   | Code | Meaning |
   |---|---|
   | `0` | ok |
   | `2` | the env file changed but the service is not confirmed active |
   | `3` | the smoke found a bad/absent credential |
   | `4` | refused before writing anything (including the production backup gate) |
   | `5` | the **edge** (Cloudflare Access) refused the request; not a token verdict |

4. Distribute the new token to each consumer out of band. Never in a repo, a chat, or a log.
5. Confirm each consumer: the pre-rotation token must now return `401`, the new one `200`.
6. Keep the encrypted backup until every consumer is confirmed.

### Production requires a backup

On the production layout (`$HOME/.config/agent-core/agent-core.env`, or
`AGENT_CORE_ENV=production`, or an explicit `--production`) a rotation with no
`--backup-recipient` is **refused**. To accept an unrecoverable rotation you must say so
explicitly:

```bash
--break-glass-no-backup     # prints a BREAK-GLASS banner; the rotation cannot be rolled back
```

The break-glass flag is for a documented emergency, never for convenience.

### Smoke cost

The smoke is **auth-only by default**: it posts a deliberately malformed `{}` body, which the
service rejects with `400 INVALID_REQUEST` *after* authenticating and *before* any provider call
or decision audit row. So it costs nothing and is safe to run on every rotation.

A **functional** smoke makes a real decision request and therefore reaches the model provider:

```bash
--smoke-functional      # PAID. Opt in deliberately.
```

An HTML response is reported as `EDGE`, not as a bad token — Cloudflare Access refusing the request
is a different problem from a rejected credential, and exit code `5` says so.

## Recovering

- **Interrupted restart** (exit `2`): the env file is already rotated. Either
  `--rollback <backup>` to restore the previous tokens, or fix the cause and run
  `--restart-only` to finish without rotating again.
- **A consumer was missed** (exit `3`, or a `401` report): roll back, then retry with a wider
  window. Do not "just rotate again" — that invalidates the tokens you already distributed.
- **Edge failure** (exit `5`): fix Cloudflare Access first. Rotating again will not help.

## Verification recipe

```bash
python3 ops/rotate-project-tokens.py --smoke --only <identity> \
    --base-url https://agent.raemanagemju.net
```

A stale token must return `401`; an accepted one returns `400 INVALID_REQUEST` in auth-only mode
(and a JSON body with a `disposition` in `--smoke-functional` mode). An **HTML** body means
Cloudflare Access refused the request before it reached the app, which is a different problem from
a bad token — the tool reports it as `EDGE` and exits `5`.

## Delivering a rotated token to a consumer host

`ops/handoff-project-token.py` streams the value over `ssh` stdin and never puts it in argv, a
local temp file, a pipeline, stdout or a log.

```bash
# dry run (default): checks the destination, writes nothing
python3 ops/handoff-project-token.py --dest /home/rae_admin/.config/rae-attendance-v2-qa/agent-core.token

# deliver
python3 ops/handoff-project-token.py --dest <abs path> --apply

# replace an existing credential (needs BOTH flags; never an accident)
python3 ops/handoff-project-token.py --dest <abs path> --apply --replace

# inventory a holder without exposing the value
python3 ops/handoff-project-token.py --dest <abs path> --verify-only
```

How the write works:

1. the payload lands in a **0600 temp file in the destination directory**;
2. its **mode and sha256 are verified before anything is renamed**;
3. only then is it renamed over the destination (same directory, so the rename is atomic);
4. the final file is re-verified, and a temp file is removed on any failure path.

Consequences worth knowing:

- A pre-rename failure **leaves an existing credential exactly as it was** — there is no window in
  which the destination is missing or half-written.
- An existing destination is refused unless `--replace` is given, and `--replace` is refused unless
  `--apply` is also given. Replacing a live credential is always deliberate.
- Symlink destinations, unsafe paths and un-ignored Git worktrees are still refused.
- After a rotation the fingerprint changes, so `HANDOFF_EXPECT_FP` must be updated before the next
  handoff will run.

## Approval gates (all require a human)

| Gate | Approver | Why |
|---|---|---|
| Confirm which identities were exposed | owner | sets the blast radius |
| Approve the `--only` list | owner | each identity has a brief outage |
| Confirm the backup recipient and key custody | owner | an undecryptable backup is not a backup |
| Approve any `--break-glass-no-backup` | owner | the rotation becomes unrecoverable |
| Approve any `--smoke-functional` run | owner | it spends provider budget |
| Execute the restart | owner | production service action |
| Deliver tokens to consumers | owner | out of band, never in a repo |
| Place the merged `ops/*.py` on the host | owner | host change, not a service deploy |
| Deploy `main` to the service | owner, separate | unrelated to rotation |

