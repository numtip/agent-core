# Evidence — ChatGPT ↔ Obsidian memory bridge end-to-end (2026-11-02)

Companion: `docs/adr/0005-chatgpt-memory-bridge.md` · `docs/integrations/CHATGPT_MEMORY_BRIDGE_DEPLOYMENT.md`
Capability: `mcp.obsidian-memory` → **ACTIVE** on 2026-11-02

This is the first record of a real ChatGPT session (not a local test) reaching the bridge.

## What the owner ran in ChatGPT

| Step | Result |
|---|---|
| Plugin | **AI-OS Obsidian Memory** (custom MCP server, Connection = Tunnel, No authentication) |
| `search` | 8 results · receipt `knw_07df6019-50af-43fa-b988-6d12d4580dab` |
| `fetch` | `30-Systems/ESXi-Audit-Bridge/ESXI-AUDIT-BRIDGE-KB.md` · **11,273 chars** · receipt `knw_614f98e0-5f02-4e28-8297-04dad5f7187f` |
| Behaviour | read-only, governance passed (owner's words) |

## Independent corroboration on the host

Receipt strings are returned to the caller and are **not persisted** by `knowledge-fabric` (the audit row records
`action`/`result`, not the receipt id), so they are recorded as owner-supplied. Everything around them was
verified on the host:

1. **The tunnel really carried MCP traffic** — `journalctl --user -u memory-bridge-tunnel` shows the dispatcher
   forwarding commands to `http://127.0.0.1:8792/mcp` in the same window, including the discovery call:

```
13:07:28 dispatcher forwarded command to MCP server  rpc_request_id":"openai-mcp-discover"
13:07:29 dispatcher forwarded command to MCP server  rpc_request_id":1
13:07:30 dispatcher forwarded command to MCP server  rpc_request_id":0
13:07:31 dispatcher acknowledged notification with control plane
```

2. **The governance instance served those calls** — `~/agent-core-memory/logs/audit.jsonl` contains
   `action: KNOWLEDGE_QUERY` with `result: CONTEXT_READY` at 06:08:52Z, 06:08:58Z, 06:10:57Z, 06:10:58Z
   (= 13:08:52 / 13:08:58 / 13:10:57 / 13:10:58 +07), matching the tunnel window. All reads, all allowed.

3. **The fetched note is exactly 11,273 characters** on disk
   (`chars: 11273 | bytes: 16639`), so the reported size matches the real file — no truncation, no invention.

4. **Control plane healthy** — `commands_poll_cycles_total` 40, `last_successful_timestamp` set,
   `GET /v1/tunnels/<id>` → 200, `/readyz` → `ready`.

5. **Bridge still read-only afterwards** — the deployment QA suite (20 checks) re-ran green after the session:
   `search` 8 governed results with `obsidian://` citation URLs and receipts, `fetch` byte-verbatim,
   `../../etc/passwd.md` and `.txt` refused, no write tool, **152 vault notes hash-unchanged**.

## Citation QA

| Question | Answer |
|---|---|
| Does `search`/`fetch` return a non-empty `url`? | **VERIFIED YES** — `obsidian://open?vault=obsidian-vault&file=<vault path>`; OpenAI creates citation metadata only for a non-empty url |
| Does ChatGPT render it as a clickable citation? | **CITATION_UI = UNVERIFIED** — the ChatGPT UI cannot be observed from this host. Needs an owner screenshot of the response with its citation/source chip. |
| Would a browser click open the note? | **INFERRED** — an `obsidian://` deep link opens the note on a machine with Obsidian and the `obsidian-vault` vault registered; it is not an http(s) URL, so a browser without the protocol handler shows a prompt instead |

## Readiness

`CHATGPT_MEMORY_BRIDGE_READY = YES` for search/fetch/governance/redaction/tunnel/authorization/vault-integrity.
`CITATION_UI = UNVERIFIED` — a UI-level claim is the only thing still missing, and it does not gate the
capability's ACTIVE state because the tool contract (url present, results correct) is proven.
