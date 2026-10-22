# Runbook: Groq isolated staging on VPS 237

**Status:** DRAFT — execute only after ADR 0002 owner approval  
**Host:** `10.1.254.237` · **Baseline SHA:** `41195f6`  
**Preflight:** `docs/pilots/HERMES_VPS_237_ISOLATED_STAGING_PREFLIGHT.md`

## Purpose

Stand up a **loopback-only** Groq inference staging instance without mutating production Agent Core (`8787`).

## Scope

- Staging: `127.0.0.1:8788`, user `prinyaroot`, user-space process or optional dedicated user unit **distinct from** `agent-core.service`.
- Production: **no** edits to `~/.config/agent-core/agent-core.env`, **no** `current` symlink change, **no** `systemctl --user restart agent-core.service` unless unrelated incident.

---

## Risk assessment (summary)

| ID | Risk | Likelihood | Impact | Mitigation |
|----|------|------------|--------|------------|
| R1 | Ledger race / overspend (multi-instance) | Medium | Medium | Single staging process; clear `18881–18888` orphans before start; dedicated `GROQ_COST_LEDGER` |
| R2 | Prod env contamination (Groq key) | Low | High | Separate `agent-core-groq-staging.env` only; grep prod env before/after |
| R3 | Auth-off scratch servers (`1888x`) | Medium | High | Remediate orphans before activation; never copy j2c9b env pattern (`auth_required=false`) |
| R4 | OpenRouter spend via fallback | Medium | Medium | `GROQ_FALLBACK_OPENROUTER=false` default; separate staging OR key if enabled |
| R5 | LAN exposure | Low | Medium | Bind `127.0.0.1` only; verify with `ss -tln` |
| R6 | Hermes write from pilot | Low | Medium | Read-only tools only; human review before any repo change |
| R7 | Model output treated as authority | Medium | High | CONTEXT-only handoff; no auto-exec hooks |

**Overall:** Acceptable **only** with ADR 0002 approval and preflight gates green.

---

## Prerequisites

1. Signed ADR 0002 with monthly USD cap.
2. Preflight doc §Prerequisites — all pass.
3. Release staged at `~/agent-core/releases/<41195f6-full-sha>/` (build + test on host).
4. Directories:

```bash
install -d -m 700 ~/agent-core/logs/groq-staging-v237
```

5. Staging env file (`600`) — **template** (fill secrets on host only):

```bash
# ~/.config/agent-core/agent-core-groq-staging.env
AGENT_CORE_ENV=development
AGENT_CORE_HOST=127.0.0.1
AGENT_CORE_PORT=8788
AGENT_CORE_AUTH_REQUIRED=true

# JSON maps — generate token on host; never commit
AGENT_CORE_PROJECT_KEYS={"groq-staging-v237":"<64-hex>"}
AGENT_CORE_PROJECT_SCOPES={"groq-staging-v237":["inference"]}

AGENT_CORE_AUDIT_LOG=/home/prinyaroot/agent-core/logs/groq-staging-v237/audit.jsonl

GROQ_PILOT_ACTIVATION=dev-only
GROQ_ENABLED=true
GROQ_API_KEY=<set-on-host>
GROQ_MODEL=openai/gpt-oss-120b
GROQ_BASE_URL=https://api.groq.com/openai/v1
GROQ_MONTHLY_BUDGET_USD=10
GROQ_COST_LEDGER=/home/prinyaroot/agent-core/logs/groq-staging-v237/groq-cost-ledger.json
GROQ_FALLBACK_OPENROUTER=false
# If owner approved fallback with ISOLATED OpenRouter key:
# GROQ_FALLBACK_OPENROUTER=true
# OPENROUTER_API_KEY=<staging-only-key>
# OPENROUTER_CHAT_URL=https://openrouter.ai/api/v1/chat/completions

PLAYWRIGHT_MCP_EXECUTION_ENABLED=false
```

---

## Orphan remediation plan (READ-ONLY until owner approves activation)

J2-C9C left **eight** Agent Core scratch servers on `127.0.0.1:18881–18888` (CWD `~/agent-workspace/agent-core-j2c9b`, `auth_required: false`). They are **not** production (`8787`) but violate the single-instance / auth contract for Groq staging.

| Phase | Action | Mutates host? |
|-------|--------|---------------|
| **P0 Inventory** | Run preflight §Orphan table + `ss -tlnp` for each port; record **current** PIDs (do not reuse stale PIDs from docs) | No |
| **P1 Impact** | Confirm `curl -sS http://127.0.0.1:8787/v1/health` still `200`; note Hermes gateway PID separate (`hermes-gateway.service`) | No |
| **P2 Decision** | Owner accepts remediation in ADR 0002 checklist | No |
| **P3 Stop (activation only)** | For each PID bound to `18881–18888` only: `kill -TERM <pid>`; wait 10s; `kill -KILL` if still listening | **Yes** — not authorized in governance/doc-only rounds |
| **P4 Verify** | All eight ports free; Hermes gateway still active; prod `8787` unchanged | Read-only after P3 |
| **P5 Contingency** | If wrong process affected: restore from `~/agent-core/backups/`; restart only the unit documented in runbook — **never** prod env | Escalation |

**P0 commands (repeat at activation time):**

```bash
for p in 18881 18882 18883 18884 18885 18886 18887 18888; do
  ss -tlnp | rg ":${p} " || echo "$p free"
done
curl -sS http://127.0.0.1:8787/v1/health | jq -r '.status, .auth_required'
systemctl --user is-active hermes-gateway.service agent-core.service
```

**Do not** stop processes during preflight or documentation work. Verify `8788` free and **no** listener serves `/v2/inference/budget` except the staging process you start.

---

## Activation procedure (future — not authorized in governance-only round)

```bash
RELEASE=~/agent-core/releases/<41195f6-sha>
ENV_FILE=~/.config/agent-core/agent-core-groq-staging.env
LOG_DIR=~/agent-core/logs/groq-staging-v237

# 0. Record prod baseline
curl -sS http://127.0.0.1:8787/v1/health | tee "$LOG_DIR/prod-health-before.json"
readlink -f ~/agent-core/current | tee "$LOG_DIR/prod-current-before.txt"

# 1. Build gate (in release tree)
cd "$RELEASE" && npm ci --omit=dev && npm test && npm run build

# 2. Start staging (foreground or dedicated unit — NOT agent-core.service)
set -a; source "$ENV_FILE"; set +a
node "$RELEASE/dist/src/server.js" &
STAGING_PID=$!
echo "$STAGING_PID" > "$LOG_DIR/staging.pid"

# 3. Wait for health
for i in $(seq 1 30); do
  curl -sf http://127.0.0.1:8788/v1/health && break
  sleep 1
done
```

Optional: add `agent-core-groq-staging.service` mirroring prod unit with different `EnvironmentFile`, `WorkingDirectory`, and `MemoryMax=512M` — **only after** unit file review.

---

## Verification

```bash
BASE=http://127.0.0.1:8788
TOKEN_FILE=~/agent-core/logs/groq-staging-v237/staging-token.hdr   # 0600, built like qa-local header files

# Health
curl -sS "$BASE/v1/health" | jq .

# Inference route exists (unauthenticated → 401)
curl -sS -o /dev/null -w '%{http_code}\n' "$BASE/v2/inference/budget"

# Authenticated budget (build header file without echoing token)
curl -sS "$BASE/v2/inference/budget" \
  -H 'x-agent-project: groq-staging-v237' \
  -H @"$TOKEN_FILE"

# Prod unchanged
curl -sS -o /dev/null -w 'prod_inference=%{http_code}\n' http://127.0.0.1:8787/v2/inference/budget

# Redaction
rg -cE '[0-9a-f]{64}' "$LOG_DIR/audit.jsonl" || true
```

**Pass:** staging budget `200` with token; prod inference `404`; audit has no 64-hex tokens.

---

## Spend limits

| Control | Default |
|---------|---------|
| `GROQ_MONTHLY_BUDGET_USD` | **10** (owner may lower in ADR 0002) |
| `GROQ_MAX_COMPLETION_TOKENS` | **1024** (do not raise without approval) |
| Overspend flag in ledger | **Stop all staging calls**; owner review before reset |

Monitor:

```bash
curl -sS http://127.0.0.1:8788/v2/inference/budget \
  -H 'x-agent-project: groq-staging-v237' -H @"$TOKEN_FILE" | jq .
```

---

## Resource limits

| Limit | Value |
|-------|--------|
| Staging `MemoryMax` (if systemd) | **512M** |
| Staging `CPUQuota` (if systemd) | **100%** |
| Concurrent load test | ≤ **3** sequential `complete` calls in QA |
| Abort if `available` Mem < **1 GiB** during test | pause staging |

---

## QA gates (activation sign-off)

| # | Gate | Evidence file |
|---|------|----------------|
| G1 | ADR 0002 signed | scanned note or ticket id in `$LOG_DIR/` |
| G2 | Preflight checklist complete | `preflight-$(date +%Y%m%d).txt` |
| G3 | `npm test` on release SHA | test log in `$LOG_DIR/` |
| G4 | Staging inference `200`, prod `404` on same route | curl outputs in `$LOG_DIR/` |
| G5 | Auth negatives (`401`/`403`) | `$LOG_DIR/qa-auth.jsonl` |
| G6 | One successful `complete` under budget | audit + ledger snapshot |
| G7 | Secret scan on audit | `rg` count 0 for 64-hex |
| G8 | Prod health identical before/after | compare JSON files |
| G9 | Hermes read-only spot check | operator note (no write actions) |

**Release to pilot use:** all G1–G9 pass and owner initials on preflight checklist.

---

## Rollback (staging only)

```bash
LOG_DIR=~/agent-core/logs/groq-staging-v237
if [ -f "$LOG_DIR/staging.pid" ]; then
  kill "$(cat "$LOG_DIR/staging.pid")" 2>/dev/null || true
  rm -f "$LOG_DIR/staging.pid"
fi
systemctl --user stop agent-core-groq-staging.service 2>/dev/null || true

# Verify prod unaffected
curl -sS http://127.0.0.1:8787/v1/health
ss -tln | rg ':8788 ' && echo 'WARN: 8788 still bound' || echo '8788 clear'
```

**Do not** remove prod env or `current` symlink. Staging ledger/audit may be archived:

```bash
tar -czf ~/agent-core/backups/groq-staging-v237-$(date +%Y%m%d).tar.gz \
  ~/agent-core/logs/groq-staging-v237 ~/.config/agent-core/agent-core-groq-staging.env
chmod 600 ~/agent-core/backups/groq-staging-v237-*.tar.gz
```

Production rollback (if ever needed for unrelated reasons): `docs/V2_ROLLBACK_RUNBOOK.md`.

---

## Troubleshooting

| Symptom | Check |
|---------|--------|
| `/v2/inference/*` → 503 `GROQ_PILOT_BLOCKED` | `AGENT_CORE_ENV` must be `development`/`test`; not `production` |
| `/v2/inference/*` → 404 | Wrong release SHA or old build |
| Budget stuck / overspend | Read ledger JSON; do not delete without archive |
| Port in use | `ss -tlnp`; resolve orphans `18881–18888` |
| Fallback charges prod OpenRouter | Ensure fallback false or staging-only OR key |

---

## Activation approval checklist (copy for owner)

See preflight doc §Activation approval checklist. Store completed copy at:

`~/agent-core/logs/groq-staging-v237/APPROVAL.md`
