# ADR 0005: Read-only MCP memory bridge for ChatGPT (Obsidian → deep research / company knowledge)

**Status:** Proposed (owner-approved implementation; deployment held) · **Date:** 2026-11-02
**Scope:** new adapter `src/memory-bridge.ts` + `src/memory-bridge-cli.ts`, registry entry `mcp.obsidian-memory`

**Labels:** `IMPLEMENTED` (adapter, CLI, tests, docs, registry entry on branch) · `VERIFIED` (unit + live
end-to-end QA against an ephemeral Agent Core) · **not** `DEPLOYED` · **not** `CONNECTED` (no ChatGPT
session has ever reached it)

## Context

The owner wants a ChatGPT account to read the same knowledge a Hermes/Agent Core agent reads: the Obsidian
vault, governed by Agent Core. AI-OS Blueprint v4.1
(`numtip/ai-operating-system/AI_OPERATING_SYSTEM_BLUEPRINT_V4.1_VALIDATED_OPERATING_BASELINE.md`) sets the
constraints that shape this decision:

- §2/§10: Hermes native memory + Obsidian are the memory layer; AI-OS and any adapter must **not** recreate
  a second memory or search engine.
- §3: read-only multi-step retrieval is `VALIDATED` and allowed at L0/L1 with an evidence destination; writes
  are `NOT_YET_PROVEN` (L2+), publish/deploy `NOT_YET_PROVEN` (L3), secrets/destructive `NOT_AUTHORIZED` (L4).
- §5.1: context is retrieval, not bulk ingestion — ≤6 files preferred, 8 hard, deterministic indexes before
  raw documents.
- §8.1: three separate verdicts (execution / target / governance) — a working adapter is not a safe system.

OpenAI's requirement for "ChatGPT deep research and company knowledge" is narrow and documented
(<https://platform.openai.com/docs/mcp>): two **read-only** tools, `search` and `fetch`, with a fixed result
shape returned both as `structuredContent` and as a JSON string in `content[]`.

## Decision

1. **A protocol shim, not an engine.** `src/memory-bridge.ts` implements MCP JSON-RPC over streamable HTTP
   (`POST /mcp`, JSON by default, SSE frame when `Accept: text/event-stream`). It contains no index, no
   embeddings, no cache and **no write path**.
2. **Retrieval is the vault, governed elsewhere.** `search` does a bounded scan of the vault (default cap:
   400 notes, 120,000 chars/note, 1,200-char snippets) and posts the candidates as `evidence` to the
   existing `/v2/knowledge/query`. Agent Core then applies project auth, hard policy, `knowledge-redaction`,
   the context governor and returns a `receipt_id`. `fetch` reads one note by vault-relative id and runs the
   same governance so redaction cannot be skipped by asking for the file directly.
3. **Ids are vault-relative paths**, so a citation is traceable to a file the owner can open. `url` is emitted
   only when `MEMORY_BRIDGE_CITATION_BASE` is configured: OpenAI creates citation metadata only for a
   non-empty `url`, and inventing a link that 404s would be worse than no citation.
4. **Auth is passed through, not re-implemented.** The bridge holds a project identity in the environment and
   forwards it to Agent Core; a caller with a bad identity gets Agent Core's `401`, surfaced as JSON-RPC
   `-32001`. A non-loopback bind **requires** `MEMORY_BRIDGE_BEARER_TOKEN` (the CLI refuses to start
   otherwise), so this cannot silently become a new public unauthenticated endpoint.
5. **Registered as `mcp.obsidian-memory`, kind `MCP`, `operations: ["READ"]`, status `PLANNED`.** `PLANNED`
   is the honest state: the registry must not route to a service that is not deployed and not connected.
   Promotion to `ACTIVE` is gated on deployment **and** a verified ChatGPT connection.

## Reuse inventory (verified read-only before building)

| Question | Finding |
|---|---|
| Is there an MCP server pattern in this repo? | Yes — `src/mcp-playwright.ts` is an outbound **client** over streamable HTTP with `McpUnavailableError` / `McpToolError` and an injected `DisabledMcpClient` fallback. Transport/error conventions copied; no server existed. |
| Does anything already read the vault? | **No.** `OBSIDIAN_VAULT_PATH` is set and unread; `grep` over `src/` for obsidian/vault hits only `memory_store` string literals. `knowledge.memory-store` advertises `MEMORY_STORE_READ_HANDOFF` / `PROJECT_CLIENT` with client steps but has no implementation. |
| Existing client of the same contract? | `agent-workspace/openwiki-knowledge-query.py` — selects passages, redacts, posts `evidence` to `/v2/knowledge/query`. This bridge is the same pattern for the vault. |
| Existing `hermes-memory` MCP bridge? | None on this host; `~/.hermes/config.yaml` has no MCP client block (only `memory_enabled`, `memory_char_limit`). |
| Modules to reuse instead of rewriting | `policy.ts`, `knowledge-redaction.ts`, `context-governor.ts`, `knowledge-fabric.ts`, `rate-limit.ts`, `auth.ts`, `telemetry.ts`. All reused by calling Agent Core rather than importing around the guards. |

6. **Fail closed on governance, and only serve Markdown inside the vault.** `approvedContext()` accepts a
   response **only** when `disposition === "CONTEXT_READY"`; `DENIED`, `FALLBACK` (evidence blocked or
   filtered), `HANDOFF` (nothing was actually read) and an unrecognisable body all yield a tool error, and
   there is **no fallback to raw file text**. `search` returns only entries the governor kept *and* marked
   `used` (a DROP or unused entry is not a result); `fetch` serves text only when the governor returned text
   for that id, otherwise `GOVERNANCE_NOT_APPROVED:NO_TEXT_FOR:<id>`. Paths are restricted to `.md` files
   (`UNSUPPORTED_FILE_TYPE`) and validated with `realpathSync` against the real vault root, so a symlink
   planted in the vault cannot point outside it; the directory walk uses `lstatSync` and skips symlinks
   entirely, so linked content is never indexed.

## Activation (2026-11-02)

`mcp.obsidian-memory` moved from `PLANNED` to **`ACTIVE`** once the enable condition in its metadata was met —
deployed, tunnel ready, and a real ChatGPT session calling the tools. First end-to-end evidence:

- ChatGPT plugin **AI-OS Obsidian Memory** (custom MCP server, Connection = Tunnel, No authentication)
- `search` → 8 results, receipt `knw_07df6019-50af-43fa-b988-6d12d4580dab`
- `fetch` → `30-Systems/ESXi-Audit-Bridge/ESXI-AUDIT-BRIDGE-KB.md`, 11,273 chars, receipt
  `knw_614f98e0-5f02-4e28-8297-04dad5f7187f`
- Corroborated on the host: tunnel dispatcher forwarding `openai-mcp-discover` + tool calls to
  `127.0.0.1:8792/mcp`, matching `KNOWLEDGE_QUERY` / `CONTEXT_READY` audit rows, and the fetched note measuring
  exactly 11,273 characters on disk. Details: `docs/evidence/chatgpt-memory-bridge-e2e-2026-11-02.md`.

Reach is tunnel-only: the bridge still binds loopback, no Cloudflare hostname was added and no public port
exists. `CITATION_UI` stays **UNVERIFIED** — the tool contract returns a non-empty `url` (verified), but nobody
has observed ChatGPT render it as a clickable citation.

## Consequences

- ChatGPT can be given curated, redacted, receipted context without a second knowledge stack, and the vault
  never leaves read-only mode.
- The adapter adds one more process and one more place a project token lives (environment file, `0600`).
- Linear vault scan: correct for a personal vault, wrong for a large corpus. Upgrading means swapping the
  scan for an existing index, not changing the MCP surface.
- Cloudflare exposure, OAuth/CIMD, deployment and a real ChatGPT session are all still open — see
  `docs/integrations/CHATGPT_MEMORY_BRIDGE.md` §"Exposing it to ChatGPT".

## Alternatives rejected

| Option | Why not |
|---|---|
| Vector store + embeddings (the OpenAI sample server) | Duplicates knowledge infrastructure the Blueprint forbids; the vault is 148 notes. |
| Reuse the Playwright MCP client path | That is a browser control plane, not a knowledge reader. |
| Point ChatGPT straight at Agent Core `/v2/knowledge/query` | Its contract returns a **handoff** (`PROJECT_CLIENT`), not results; ChatGPT cannot perform the client step. This is exactly the gap the bridge fills. |
| Build the bridge inside the Agent Core Fastify app | The knowledge surface is already guarded per-route; a second protocol on the same port would blur the auth model and force a production restart to ship. |

## Rollback

`git revert` the merge commit; stop any started process (`systemctl --user stop memory-bridge`). No data,
schema, vault or Cloudflare state is touched by this change.

## Verdicts (§8.1)

- **Execution verdict:** PASS — 17 unit tests, 21-step live QA all pass, vault hashes unchanged.
- **Target verdict:** the bridge is correct against the documented MCP contract; its search is a linear
  scan and its inbound auth is a static bearer token, so it is not yet suitable for public exposure.
- **Governance verdict:** nothing is authorized beyond loopback. Exposure (Cloudflare route + OAuth or
  bearer), deployment, and the ChatGPT-side connection each need owner approval.
