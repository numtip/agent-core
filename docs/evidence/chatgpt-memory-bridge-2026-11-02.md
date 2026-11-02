# Evidence — ChatGPT Obsidian memory bridge (read-only MCP)

Date: 2026-11-02 · Host: VPS 237 (`ubantu24`) · Branch: `feat/chatgpt-memory-bridge`
Companion: `docs/adr/0005-chatgpt-memory-bridge.md`, `docs/integrations/CHATGPT_MEMORY_BRIDGE.md`

## Environment used

| Piece | Instance | Why |
|---|---|---|
| Agent Core | ephemeral test instance, `127.0.0.1:8799`, `AGENT_CORE_ENV=test` | never touch production `:8787` |
| Project identity | `memory-bridge-qa` with scopes `route,context,qa,metrics` | proves real project auth + scope |
| Bridge (good token) | `127.0.0.1:8792` | normal path |
| Bridge (wrong token) | `127.0.0.1:8793` | authorization-denial path |
| Vault | `/home/prinyaroot/obsidian-vault` (148 notes, 480,540 bytes) | real notes, read-only |

## A. OpenAI MCP conformance

Requirements quoted in `docs/integrations/CHATGPT_MEMORY_BRIDGE.md` §"What OpenAI requires", source
<https://platform.openai.com/docs/mcp>. Implemented: `search` + `fetch` naming, `{results:[{id,title,url?}]}`
/ `{id,title,text,url?,metadata}` shapes, `structuredContent` **and** JSON-string `content[]`, per-tool
`outputSchema`, `readOnlyHint:true` / `destructiveHint:false`, `initialize` / `notifications/initialized` /
`ping` / `tools/list` / `tools/call`, streaming HTTP with SSE framing when the client asks for it.

## B. End-to-end QA transcript (real HTTP, real vault)

```
VAULT: 148 notes, 480540 bytes total

PASS initialize  [200 application/json; charset=utf-8]
PASS initialized notification -> 202/200  [202]
PASS tools/list = search+fetch  [['search', 'fetch']]
PASS read-only annotations
PASS search returns results  [8 results]
PASS search results have id+title
PASS search content mirrors structuredContent
PASS search cites real vault path  [30-Systems/ESXi-Audit-Bridge/ESXI-AUDIT-BRIDGE-KB.md]
PASS no fake url emitted (citation_base unset)
PASS fetch returns text  [11273 chars]
PASS fetch text is verbatim from the note (source accuracy)
PASS fetch carries governance receipt  [knw_d0da6791-64fa-462f-b44d-4584c39a8005]
PASS fetch declares knowledge-is-not-authority
  token efficiency: fetch 24318 B vs vault 480540 B (5.313% of vault)
PASS bad project token -> upstream 401 surfaced  [200 {'code': -32001, 'message': 'UNAUTHORIZED'}]
PASS traversal blocked for ../../etc/passwd
PASS traversal blocked for /etc/passwd
PASS Accept: text/event-stream -> SSE frame  [200 text/event-stream; charset=utf-8]
PASS unknown tool is a tool error, no write path
PASS unknown method -> -32601
PASS vault untouched (all notes hashed)  [148 notes, 0 changed]

RESULT: ALL PASS

--- healthz ---
{"status":"ok","server":{"name":"obsidian-memory-bridge","version":"1.0.0"},"transport":"streamable-http+json","tools":["search","fetch"],"read_only":true,"citation_base":null,"auth":"loopback-only"}
--- unit test count ---
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

## C. Readings

- **Discovery**: `tools/list` returns exactly `search` and `fetch`, both read-only, both with an output schema.
- **Retrieval accuracy**: `fetch` text is byte-verbatim from the note on disk (`sc["text"].strip()[:400]` is a
  substring of the file). Search returned the correct KB note as the top hit for an ESXi query.
- **Governance**: every fetch carries a `receipt_id` from `/v2/knowledge/query` and asserts
  `knowledge_is_not_authority: true`. Secret redaction is the existing `src/knowledge-redaction.ts`.
- **Authorization**: a bridge holding a wrong project token gets `401` from Agent Core and surfaces it as
  JSON-RPC `-32001 UNAUTHORIZED` — the bridge adds no auth bypass of its own.
- **Token efficiency**: one `fetch` of an 11,273-char note cost 24,318 bytes of response against a
  480,540-byte vault (5.3%); `search` returns ids/titles only, so a client pays for content on demand.
- **Read-only proof**: SHA-256 of all 148 notes identical before and after the whole QA run; path traversal
  (`../../etc/passwd`, `/etc/passwd`) refused; `write_note` is not a tool.

## D. Not verified — and why the verdict is PARTIAL

- No Cloudflare route was added and the bridge was never bound beyond `127.0.0.1`. Nothing is publicly
  reachable, so no ChatGPT workspace could reach it.
- ChatGPT account compatibility was **not** tested against a live ChatGPT session. Server-side protocol
  readiness is verified; the ChatGPT-side connection is not.
- OAuth (CIMD/DCR) was not implemented — the inbound auth path is a static bearer token, which is the
  owner-gated option, not the OpenAI-preferred one.
- Production `127.0.0.1:8787` was never called by the bridge during QA; it is the target for a future
  deployment, not a dependency of these tests.
