# ChatGPT → Obsidian memory bridge (read-only MCP)

A minimal MCP adapter that lets ChatGPT deep research / company knowledge search and fetch notes from the
owner's Obsidian vault. It is a protocol shim: retrieval is a bounded vault scan, and **all** governance
(auth, hard policy, secret redaction, context ranking, receipts) stays in the Agent Core endpoint that
already does it — `/v2/knowledge/query`.

- Entry point: `src/memory-bridge-cli.ts` (`npm run memory-bridge`)
- Adapter: `src/memory-bridge.ts`
- Tests: `tests/memory-bridge.test.ts`
- Capability: `mcp.obsidian-memory` in `src/capability-registry.ts` (status `PLANNED` until deployed)
- ADR: `docs/adr/0005-chatgpt-memory-bridge.md`

## What OpenAI requires (verified 2026-11-02)

Source: <https://platform.openai.com/docs/mcp> ("Building MCP servers for plugins and API integrations").
Quoted lines that drove the implementation:

> "To work with ChatGPT deep research and company knowledge, your MCP server should implement two
> read-only tools: `search` and `fetch`, using the compatibility schema in Company knowledge compatibility."

> "`search` … _Arguments:_ A single query string. _Returns:_ An object with a single key, `results`, whose
> value is an array of result objects. Each result object should include: `id`, `title`, `url`."

> "`fetch` … _Arguments:_ A string which is a unique identifier for the search document. _Returns:_ A single
> object with … `id`, `title`, `text`, `url`, `metadata`."

> "In MCP, return this object as `structuredContent` and include the same value as a JSON-encoded string in
> the content array for compatibility."

> "ChatGPT creates citation metadata only when `url` is a non-empty string."

Transport and auth, from <https://developers.openai.com/api/docs/guides/custom-mcp-server>:

> "Supported MCP protocols: SSE and streaming HTTP."
> "Authentication options include **OAuth**, **No authentication**, and **OAuth or no authentication**."

Conformance in this implementation:

| Requirement | Where |
|---|---|
| tools named exactly `search`, `fetch` | `toolDefinitions` in `src/memory-bridge.ts` |
| `search` takes one query string, returns `{results:[{id,title,url?}]}` | `search()` |
| `fetch` takes an id, returns `{id,title,text,url?,metadata}` | `fetchDoc()` |
| result also mirrored as a JSON string in `content[]` | `textAndStructure()` |
| output schema declared per tool | `outputSchema` on both tools |
| `readOnlyHint: true`, `destructiveHint: false` | annotations on both tools |
| `initialize` / `tools/list` / `tools/call` / `ping` | JSON-RPC dispatcher |
| streaming HTTP | `POST /mcp`, JSON by default, SSE frame when `Accept: text/event-stream` |
| citation-ready `url` | only when `MEMORY_BRIDGE_CITATION_BASE` is set — no fake links are emitted |

## Architecture

```
ChatGPT  --MCP (streamable HTTP)-->  memory-bridge 127.0.0.1:8792  --read-only-->  Obsidian vault
                                          |
                                          +--POST /v2/knowledge/query-->  Agent Core 127.0.0.1:8787
                                             (project auth, hard policy, redaction,
                                              context governor, receipt_id)
```

Deliberately **not** built: a second search engine, a vector store, an index, an embeddings pipeline, or any
write path. There is no code in `src/memory-bridge.ts` that opens the vault for writing.

## Configuration (environment only — never argv, never a file in git)

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `MEMORY_BRIDGE_VAULT_PATH` (or `OBSIDIAN_VAULT_PATH`) | yes | — | vault root |
| `MEMORY_BRIDGE_PROJECT` | yes | — | Agent Core project identity used for the upstream call |
| `MEMORY_BRIDGE_PROJECT_TOKEN` | yes | — | that project's token (secret) |
| `AGENT_CORE_URL` | no | `http://127.0.0.1:8787` | governed knowledge endpoint base |
| `MEMORY_BRIDGE_HOST` / `MEMORY_BRIDGE_PORT` | no | `127.0.0.1` / `8792` | listen address |
| `MEMORY_BRIDGE_BEARER_TOKEN` | no | unset | inbound auth; **required** for any non-loopback bind |
| `MEMORY_BRIDGE_CITATION_BASE` | no | unset | public read-only base URL appended to vault paths for citations |

Fail-closed behaviour: missing vault path, missing project identity, invalid port, or a non-loopback bind
without a bearer token all exit non-zero before listening.

## Run

```bash
cd /home/prinyaroot/agent-workspace/agent-core
MEMORY_BRIDGE_PROJECT=<project> MEMORY_BRIDGE_PROJECT_TOKEN=<token> \
MEMORY_BRIDGE_VAULT_PATH=/home/prinyaroot/obsidian-vault \
AGENT_CORE_URL=http://127.0.0.1:8787 \
npm run memory-bridge
```

Readiness: `curl -s http://127.0.0.1:8792/healthz`

### systemd user unit (not installed by this PR)

```ini
[Unit]
Description=Obsidian memory bridge (read-only MCP)
After=network.target

[Service]
WorkingDirectory=/home/prinyaroot/agent-workspace/agent-core
EnvironmentFile=%h/.config/memory-bridge.env
ExecStart=/home/prinyaroot/.nvm/versions/node/v22.22.2/bin/npx tsx src/memory-bridge-cli.ts
Restart=on-failure

[Install]
WantedBy=default.target
```

`~/.config/memory-bridge.env` must be `0600` and hold the three required variables plus `AGENT_CORE_URL`.

## Exposing it to ChatGPT (owner-gated — not done here)

Server readiness is not the same as a ChatGPT connection. Nothing is exposed today. To connect, an owner
must, in order:

1. Decide the inbound auth model — OAuth (CIMD/DCR, preferred by OpenAI) or a static bearer token.
2. Add a hostname/path on the **existing** Cloudflare tunnel to `127.0.0.1:8792` (a CF config change).
3. Set `MEMORY_BRIDGE_BEARER_TOKEN` (or front it with an OAuth proxy) and only then bind beyond loopback.
4. Add the server in ChatGPT: Plugins → **Add custom MCP server** → server URL `/mcp`.
5. Verify with a real prompt that `search` and `fetch` are called and citations resolve.

Until step 5 is actually observed, `CHATGPT_MEMORY_BRIDGE_READY` is **PARTIAL**.

## Tests and evidence

```bash
npx vitest run tests/memory-bridge.test.ts   # 17 tests
```

End-to-end QA (real HTTP, real vault, ephemeral Agent Core on 8799 — never the production 8787):
`docs/evidence/chatgpt-memory-bridge-2026-11-02.md`.

## Rollback

1. `git revert <merge commit>` — removes adapter, tests, capability entry, docs.
2. Stop the process/unit if one was ever started: `systemctl --user stop memory-bridge`.
3. No data migration, no vault change, no schema change to unwind.

## Known limits

- Search is a linear scan (default cap 400 notes / 120k chars per note). Fine for a personal vault; it is
  not a search engine and will not scale to a large corpus.
- `metadata` on the capability is declarative; the enforced controls are `operations` and `evaluateHardPolicy()`.
- Citation URLs stay absent until a public base is configured, per OpenAI's rule that citation metadata
  requires a non-empty `url`. Paths are still returned in `metadata.vault_path` and in the text.
