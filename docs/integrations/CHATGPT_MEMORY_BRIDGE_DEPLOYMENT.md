# Memory bridge — activation record (2026-11-02)

**Status:** `DEPLOYED` · `TUNNELED` · **`CONNECTED`** (ChatGPT reached search + fetch on 2026-11-02) ·
capability `mcp.obsidian-memory` = **ACTIVE** · `CITATION_UI` = **UNVERIFIED** (no observed ChatGPT rendering)

E2E evidence: `docs/evidence/chatgpt-memory-bridge-e2e-2026-11-02.md`

What is live on this host right now, as user-scoped systemd units, all loopback-only:

| Unit | Listens | What it is |
|---|---|---|
| `agent-core-memory.service` | `127.0.0.1:8794` | Agent Core built from `main` @ `025002f`, serving **only** the knowledge/context governance path. Isolated from production `:8787` and staging `:8788`. |
| `memory-bridge.service` | `127.0.0.1:8792` | The read-only MCP adapter (`dist/src/memory-bridge-cli.js`). Vault mounted read-only for this unit. |
| `memory-bridge-tunnel.service` | none | OpenAI `tunnel-client` wrapper — **written but deliberately disabled** until the owner supplies a tunnel id + runtime API key. |

## Why a dedicated Agent Core instance instead of the running one

The bridge needs its own least-privilege project identity. Adding an identity to `agent-core.service` means
editing its env file and restarting it — a production restart. Instead a third instance runs the same code from
the same build with a single project:

```
AGENT_CORE_PROJECT_KEYS={"memory-bridge":"<32-byte hex, generated locally, 0600>"}
AGENT_CORE_PROJECT_SCOPES={"memory-bridge":["context"]}
AGENT_CORE_AUTH_REQUIRED=true
AGENT_CORE_RATE_LIMIT_MAX=60
```

Verified least privilege: `/v2/capabilities` (needs `route`) returns **403** for this identity, while
`/v2/context/govern` (needs `context`) returns **200**. No other scope is granted, and no provider credentials
or inference keys are given to this instance.

## Files an operator needs (all outside git, all `0600`)

| Path | Contents |
|---|---|
| `~/.config/agent-core-memory/agent-core.env` | port/host/auth/project key + scopes, audit log path |
| `~/.config/memory-bridge/memory-bridge.env` | vault path, project id + token, `AGENT_CORE_URL=http://127.0.0.1:8794`, bind `127.0.0.1:8792` |
| `~/.config/tunnel-client/owner-inputs.env` | **template** — `CONTROL_PLANE_TUNNEL_ID` and `CONTROL_PLANE_API_KEY` to be filled by the owner |
| `~/.config/systemd/user/{agent-core-memory,memory-bridge,memory-bridge-tunnel}.service` | unit definitions |

Secrets are generated with `secrets.token_hex(32)` on the host and never printed, never written to git, and never
logged. The bridge's own inbound bearer token is intentionally unset: ChatGPT cannot present one, the listener
is loopback-only, and the tunnel identity is the authentication boundary.

## Verification performed (2026-11-02, 20/20 checks)

```
PASS agent-core-memory healthy (:8794)  [0.7.0]
PASS least privilege: /v2/capabilities denied (needs route scope)  [403]
PASS least privilege: /v2/context/govern allowed (context scope)  [200]
PASS wrong token rejected by the governance instance  [401]
PASS no token rejected (auth required)  [401]
PASS bridge /healthz ready on :8792
PASS MCP initialize  [2025-06-18]
PASS MCP tools/list = search+fetch
PASS tools are read-only
PASS search returns governed results  [8 results]
PASS search results carry citation url  [obsidian://open?vault=obsidian-vault&file=…]
PASS search results carry a governance receipt
PASS fetch returns governed text  [11273 chars]
PASS fetched text is verbatim from disk
PASS fetch carries receipt + knowledge-is-not-authority
PASS refused ../../etc/passwd.md
PASS refused 30-Systems/AI-OS/ARCHITECTURE.txt
PASS no write tool exists
PASS vault untouched by the deployed bridge  [151 notes, 0 changed]
```

Production untouched: `:8787` and `:8788` still `200`, `agent-core.service` up since 2026-10-30 12:02,
`agent-core-groq-staging.service` up since 2026-10-28 15:22, release symlink still
`releases/5ae20af`.

## Tunnel readiness

- `tunnel-client` **v0.0.19** installed at `~/.local/bin/tunnel-client` from the official release asset
  `tunnel-client-v0.0.19-linux-amd64.zip`; SHA-256 checked against the release `SHA256SUMS.txt`
  (`9ee9448592345a9dd1517fb79791ab54d24f051142eb92bcbe8cd355effc9142`). Version reported by the binary:
  `0.0.19+01d67bb4da0d8359b808b4761f8db171ab682cd7`.
- Outbound connectivity verified: `https://api.openai.com/v1/models` answers `401` (reachable, unauthenticated),
  so no inbound port and no Cloudflare change is needed.
- **No tunnel exists yet.** No prior `tunnel-client` install, profile or tunnel id was found on this host, so
  nothing was reused. `doctor` and `run` are blocked on owner-supplied credentials.

### Exact owner steps (3 values, then one command)

1. Create a tunnel at <https://platform.openai.com/settings/organization/tunnels> → copy `tunnel_…`.
2. Create a **runtime** API key with Tunnels Read + Use at
   <https://platform.openai.com/settings/organization/api-keys>.
3. Fill `~/.config/tunnel-client/owner-inputs.env` (0600) with both values — do not paste them into chat.
4. The activation commands (run once, by whoever holds the file):

```bash
set -a; . ~/.config/tunnel-client/owner-inputs.env; set +a
~/.local/bin/tunnel-client init \
  --sample sample_mcp_remote_no_auth \
  --profile obsidian-vault \
  --tunnel-id "$CONTROL_PLANE_TUNNEL_ID" \
  --mcp-server-url http://127.0.0.1:8792/mcp \
  --health-listen-addr 127.0.0.1:8795
~/.local/bin/tunnel-client doctor --profile obsidian-vault --explain
# then copy owner-inputs.env to tunnel.env and start the unit
install -m 0600 ~/.config/tunnel-client/owner-inputs.env ~/.config/tunnel-client/tunnel.env
systemctl --user enable --now memory-bridge-tunnel.service
```

`sample_mcp_remote_no_auth` is the correct built-in profile: "remote HTTP MCP server that does not advertise
OAuth/PRMD metadata" — our bridge implements no OAuth, and the listener is loopback-only.

5. In ChatGPT: Plugins → **Add custom MCP server** → Connection **Tunnel** → select the same tunnel → auth →
   create, then test a prompt that must call `search` then `fetch`.

## Rollback

```bash
systemctl --user disable --now memory-bridge-tunnel.service memory-bridge.service agent-core-memory.service
# code itself is unchanged on disk; remove the units and env files if the deployment is abandoned:
rm -f ~/.config/systemd/user/{memory-bridge-tunnel,memory-bridge,agent-core-memory}.service
systemctl --user daemon-reload
```

Nothing to migrate: no data store, no schema, no vault write, no Cloudflare or DNS change. Production services
were never touched, so there is nothing to restore there.

## Activation

`mcp.obsidian-memory` is `ACTIVE` as of 2026-11-02, after a real ChatGPT session (plugin **AI-OS Obsidian
Memory**, Connection = Tunnel) called `search` (8 results, receipt `knw_07df6019…`) and `fetch`
(11,273 chars, receipt `knw_614f98e0…`) through this deployment. The promotion carries
`metadata.activated_at` + `metadata.activation_evidence`, and a test asserts both so an `ACTIVE` claim cannot be
made without them.

Still unproven: **CITATION_UI** — the tools return a non-empty `obsidian://` url (verified), but whether ChatGPT
renders it as a clickable citation has not been observed. Needs an owner screenshot.
