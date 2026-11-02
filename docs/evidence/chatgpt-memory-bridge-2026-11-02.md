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


## C2. Reused retrieval path, verified before the bridge was written

`/v2/knowledge/query` is a governance gate, not a search engine: with no evidence it returns a **handoff**
telling the client where to pull from, and with evidence it returns governed context. Both halves were run
against the real vault before any bridge code existed:

```
STEP 1 no-evidence handler -> 200 HANDOFF MEMORY_STORE_READ_HANDOFF | capability: knowledge.memory-store | transport: PROJECT_CLIENT | client_steps: 3
STEP 2 with 3 real vault notes -> 200 CONTEXT_READY | receipt: knw_834eef41-1822-4b37-af4b-aeeb8f2174c2 | blocked: 0
    KEEP | 30-Systems/ESXi-Audit-Bridge/ESXI-AUDIT-BRIDGE-KB.md | 11273 chars
    KEEP | 30-Systems/AI-OS/PROJECT_REGISTRY.md | 2374 chars
    KEEP | 40-Decisions/2026-10-30-esxi-bridge-python-production-node-qa-reference.md | 2402 chars
   provenance redaction: [{"id":"ESXI-AUDIT-BRIDGE-KB.md","redacted":false,"reasons":[]},{"id":"PROJECT_REGISTRY.md","redacted":false,"reasons":[]},{"id":"2026-10-30-esxi-bridge-python-production-node-qa-reference.md","redacted":true,"reasons":["bearer"]}]
   guardrails: {"read_only":true,"knowledge_is_not_authority":true,"verify_source_of_truth_before_execution":true}```

Readings:

- The knowledge path already returns **source citations** (`id` = vault-relative path) plus a `receipt_id`, and
  the context governor decides KEEP/COMPRESS/DROP per item — the bridge therefore adds no ranking of its own.
- The `bearer` redaction hit is the existing `src/knowledge-redaction.ts` rule firing on the Jev decision note.
  It is worth a look by the owner: that note contains a `Bearer …` string, redacted here but still present in
  the vault file.
- `knowledge_is_not_authority: true` and `read_only: true` are returned on every governed response.

## B2. Final run after the spec review (citations on, deny-bridge included)

```
PASS fetch carries governance receipt  [knw_064153dd-29bf-47b7-8e85-f932e7f8df00]
PASS fetch declares knowledge-is-not-authority
  token efficiency: fetch 24528 B vs vault 482498 B (5.313% of vault)
PASS bad project token -> upstream 401 surfaced  [200 {'code': -32001, 'message': 'UNAUTHORIZED'}]
PASS traversal blocked for ../../etc/passwd
PASS traversal blocked for /etc/passwd
PASS Accept: text/event-stream -> SSE frame  [200 text/event-stream; charset=utf-8]
PASS unknown tool is a tool error, no write path
PASS unknown method -> -32601
PASS vault untouched (all notes hashed)  [149 notes, 0 changed]

RESULT: ALL PASS
--- newest vault files
2026-11-02 11:03:34.817461414 +0700 /home/prinyaroot/obsidian-vault/40-Decisions/JEV-LEDGER.md
2026-11-02 11:03:34.816461414 +0700 /home/prinyaroot/obsidian-vault/40-Decisions/2026-11-02-jev-merge-pr-numtip-agent-core-pr49-hold.md
2026-11-02 10:38:44.837255137 +0700 /home/prinyaroot/obsidian-vault/40-Decisions/2026-11-02-jev-merge-pr-numtip-agent-core-pr48-hold.md```

Vault note count moved 147 → 149 during the session because an automation writes Jev decision records into
`40-Decisions/` when a PR is opened (`2026-11-02-jev-merge-pr-...-pr49-hold.md`, mtime 11:03:34). No file in
the vault was written by the bridge or by this work; the QA hash check is what proves that.

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
