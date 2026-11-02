import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { queryKnowledgeFabric } from "../src/knowledge-fabric.js";
import { createDefaultCapabilityRegistry } from "../src/capability-registry.js";
import { createMemoryBridge, type MemoryBridgeOptions } from "../src/memory-bridge.js";

// The bridge's production governance call is Agent Core's /v2/knowledge/query. In tests we inject the
// same code path in-process, so auth/scope/rate limiting stay out of scope while redaction, hard policy
// and the context governor are the real implementations.
const govern: MemoryBridgeOptions["knowledgeQuery"] = async (body) => ({
  status: 200,
  body: queryKnowledgeFabric(body)
});

let vault: string;
let app: Awaited<ReturnType<typeof createMemoryBridge>>;
const SECRET = "sk-abcdefghijklmnopqrstuvwxyz012345"; // matches the existing openai_key rule (sk-[A-Za-z0-9]{20,}) in src/knowledge-redaction.ts

function call(payload: unknown, headers: Record<string, string> = {}) {
  return app.inject({ method: "POST", url: "/mcp", headers: { "content-type": "application/json", ...headers }, payload: payload as any });
}

beforeAll(async () => {
  vault = mkdtempSync(join(tmpdir(), "memory-bridge-vault-"));
  mkdirSync(join(vault, "30-Systems"), { recursive: true });
  mkdirSync(join(vault, "40-Decisions"), { recursive: true });
  writeFileSync(
    join(vault, "30-Systems/ESXI-AUDIT-BRIDGE.md"),
    "---\ntitle: ESXi Audit Bridge\n---\n\n# ESXi Audit Bridge\n\nThe bridge exposes a read-only inventory over a Unix socket. Permission denied on ls means the session is stale.\n"
  );
  writeFileSync(
    join(vault, "40-Decisions/2026-10-30-bridge.md"),
    "---\ntitle: Bridge decision\n---\n\nDecision: production code is Python at /opt. Rotated key " + SECRET + " must never be echoed.\n"
  );
  writeFileSync(join(vault, "40-Decisions/unrelated.md"), "# Groceries\n\nmilk, eggs, coffee\n");
  app = createMemoryBridge({
    vaultPath: vault,
    knowledgeQuery: govern,
    projectId: "goffice2026",
    projectToken: "test-token",
    maxResults: 3
  });
});

afterAll(() => {
  rmSync(vault, { recursive: true, force: true });
});

describe("capability registration", () => {
  it("is registered read-only and stays PLANNED until it is deployed and connected", () => {
    const capability = createDefaultCapabilityRegistry().get("mcp.obsidian-memory");
    expect(capability?.kind).toBe("MCP");
    expect(capability?.operations).toEqual(["READ"]);
    expect(capability?.status).toBe("PLANNED");
    expect(capability?.metadata.read_only).toBe(true);
    expect(capability?.metadata.vault_write).toBe("deny");
  });
});

describe("MCP discovery", () => {
  it("answers initialize with a protocol version, server info and instructions", async () => {
    const res = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "chatgpt", version: "1" } } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result.protocolVersion).toBe("2025-06-18");
    expect(body.result.serverInfo.name).toBe("obsidian-memory-bridge");
    expect(body.result.capabilities.tools).toBeTruthy();
    expect(body.result.instructions.length).toBeGreaterThan(20);
  });

  it("echoes the protocol version the client asked for when it is supported", async () => {
    for (const asked of ["2025-11-25", "2025-03-26"]) {
      const body = (await call({ jsonrpc: "2.0", id: 100, method: "initialize", params: { protocolVersion: asked } })).json();
      expect(body.result.protocolVersion).toBe(asked);
    }
    const unknown = (await call({ jsonrpc: "2.0", id: 101, method: "initialize", params: { protocolVersion: "1999-01-01" } })).json();
    expect(unknown.result.protocolVersion).toBe("2025-06-18");
  });

  it("annotates both tools with openWorldHint:false (no internet access from a tool call)", async () => {
    const body = (await call({ jsonrpc: "2.0", id: 102, method: "tools/list" })).json();
    for (const tool of body.result.tools) expect(tool.annotations.openWorldHint).toBe(false);
  });

  it("answers GET and DELETE on /mcp with 405 instead of 404", async () => {
    for (const method of ["GET", "DELETE"] as const) {
      const res = await app.inject({ method, url: "/mcp" });
      expect(res.statusCode).toBe(405);
      expect(res.headers.allow).toBe("POST");
    }
  });

  it("accepts the initialized notification without a body", async () => {
    const res = await call({ jsonrpc: "2.0", method: "notifications/initialized" });
    expect(res.statusCode).toBe(202);
  });

  it("lists exactly the two read-only tools ChatGPT expects, with schemas and hints", async () => {
    const body = (await call({ jsonrpc: "2.0", id: 2, method: "tools/list" })).json();
    expect(body.result.tools.map((tool: any) => tool.name)).toEqual(["search", "fetch"]);
    for (const tool of body.result.tools) {
      expect(tool.annotations.readOnlyHint).toBe(true);
      expect(tool.annotations.destructiveHint).toBe(false);
      expect(tool.inputSchema.required.length).toBe(1);
      expect(tool.outputSchema).toBeTruthy();
      expect(tool.description).toContain("Use this when");
    }
  });

  it("rejects an unknown method with JSON-RPC error -32601", async () => {
    const body = (await call({ jsonrpc: "2.0", id: 3, method: "resources/list" })).json();
    expect(body.error.code).toBe(-32601);
  });
});

describe("search", () => {
  it("returns results as structuredContent and as a JSON string in content", async () => {
    const res = await call({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "search", arguments: { query: "unix socket permission denied" } } });
    const result = res.json().result;
    expect(result.isError).toBeUndefined();
    const ids = result.structuredContent.results.map((r: any) => r.id);
    expect(ids).toContain("30-Systems/ESXI-AUDIT-BRIDGE.md");
    expect(ids).not.toContain("40-Decisions/unrelated.md");
    expect(JSON.parse(result.content[0].text)).toEqual(result.structuredContent);
    expect(result.structuredContent.results[0].title).toBe("ESXi Audit Bridge");
  });

  it("cites through a URL only when a public base is configured", async () => {
    const without = (await call({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "search", arguments: { query: "unix socket" } } })).json();
    expect(without.result.structuredContent.results[0].url).toBeUndefined();
    expect(without.result.structuredContent.results[0].metadata.vault_path).toMatch(/ESXI-AUDIT-BRIDGE\.md$/);

    const cited = createMemoryBridge({ vaultPath: vault, knowledgeQuery: govern, projectId: "goffice2026", projectToken: "t", citationBase: "https://kb.example.test/notes" });
    const withUrl = (await cited.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "search", arguments: { query: "unix socket" } } } as any })).json();
    expect(withUrl.result.structuredContent.results[0].url).toBe("https://kb.example.test/notes/30-Systems/ESXI-AUDIT-BRIDGE.md");

    const deepLink = createMemoryBridge({ vaultPath: vault, knowledgeQuery: govern, projectId: "p", projectToken: "t", citationBase: "obsidian://open?vault=vault&file=" });
    const viaObsidian = (await deepLink.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 103, method: "tools/call", params: { name: "search", arguments: { query: "unix socket" } } } as any })).json();
    expect(viaObsidian.result.structuredContent.results[0].url).toBe("obsidian://open?vault=vault&file=30-Systems/ESXI-AUDIT-BRIDGE.md");
  });

  it("respects the result cap and returns an empty list for a miss", async () => {
    const capped = (await call({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "search", arguments: { query: "bridge" } } })).json();
    expect(capped.result.structuredContent.results.length).toBeLessThanOrEqual(3);
    const miss = (await call({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "search", arguments: { query: "zzzz-no-such-term" } } })).json();
    expect(miss.result.structuredContent.results).toEqual([]);
  });

  it("rejects an empty query as a tool error, not a crash", async () => {
    const body = (await call({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "search", arguments: { query: "   " } } })).json();
    expect(body.result.isError).toBe(true);
  });
});

describe("fetch", () => {
  it("returns the governed note text with its receipt", async () => {
    const result = (await call({ jsonrpc: "2.0", id: 10, method: "tools/call", params: { name: "fetch", arguments: { id: "30-Systems/ESXI-AUDIT-BRIDGE.md" } } })).json().result;
    expect(result.structuredContent.id).toBe("30-Systems/ESXI-AUDIT-BRIDGE.md");
    expect(result.structuredContent.text).toContain("read-only inventory");
    expect(result.structuredContent.metadata.receipt_id).toMatch(/^knw_/);
    expect(result.structuredContent.metadata.knowledge_is_not_authority).toBe(true);
  });

  it("redacts a secret before it can reach the model", async () => {
    const result = (await call({ jsonrpc: "2.0", id: 11, method: "tools/call", params: { name: "fetch", arguments: { id: "40-Decisions/2026-10-30-bridge.md" } } })).json().result;
    expect(result.structuredContent.text).not.toContain(SECRET);
    expect(result.structuredContent.metadata.redacted).toBe(true);
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it("refuses to read outside the vault", async () => {
    for (const id of ["../../etc/passwd", "/etc/passwd", "30-Systems/../../etc/passwd"]) {
      const result = (await call({ jsonrpc: "2.0", id: 12, method: "tools/call", params: { name: "fetch", arguments: { id } } })).json().result;
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result)).not.toContain("root:");
    }
  });

  it("reports a missing note as a tool error", async () => {
    const result = (await call({ jsonrpc: "2.0", id: 13, method: "tools/call", params: { name: "fetch", arguments: { id: "30-Systems/nope.md" } } })).json().result;
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("NOTE_NOT_FOUND");
  });
});

describe("authorization and read-only guarantees", () => {
  it("refuses every call once a bearer token is required", async () => {
    const guarded = createMemoryBridge({ vaultPath: vault, knowledgeQuery: govern, projectId: "goffice2026", projectToken: "t", bearerToken: "s3cret-bearer" });
    const anonymous = await guarded.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 14, method: "tools/list" } as any });
    expect(anonymous.statusCode).toBe(401);
    expect(anonymous.json().error.message).toBe("UNAUTHORIZED");
    const wrong = await guarded.inject({ method: "POST", url: "/mcp", headers: { authorization: "Bearer nope" }, payload: { jsonrpc: "2.0", id: 15, method: "tools/list" } as any });
    expect(wrong.statusCode).toBe(401);
    const right = await guarded.inject({ method: "POST", url: "/mcp", headers: { authorization: "Bearer s3cret-bearer" }, payload: { jsonrpc: "2.0", id: 16, method: "tools/list" } as any });
    expect(right.statusCode).toBe(200);
  });

  it("surfaces an upstream project-scope denial as a JSON-RPC error", async () => {
    const denying = createMemoryBridge({
      vaultPath: vault,
      knowledgeQuery: async () => {
        const error: any = new Error("AGENT_CORE_403");
        error.upstreamStatus = 403;
        throw error;
      },
      projectId: "goffice2026",
      projectToken: "t"
    });
    const res = await denying.inject({ method: "POST", url: "/mcp", payload: { jsonrpc: "2.0", id: 17, method: "tools/call", params: { name: "fetch", arguments: { id: "30-Systems/ESXI-AUDIT-BRIDGE.md" } } } as any });
    expect(res.json().error.code).toBe(-32003);
  });

  it("never modifies the vault", async () => {
    const before = readFileSync(join(vault, "30-Systems/ESXI-AUDIT-BRIDGE.md"));
    await call({ jsonrpc: "2.0", id: 18, method: "tools/call", params: { name: "fetch", arguments: { id: "30-Systems/ESXI-AUDIT-BRIDGE.md" } } });
    await call({ jsonrpc: "2.0", id: 19, method: "tools/call", params: { name: "search", arguments: { query: "bridge" } } });
    const after = readFileSync(join(vault, "30-Systems/ESXI-AUDIT-BRIDGE.md"));
    expect(createHash("sha256").update(after).digest("hex")).toBe(createHash("sha256").update(before).digest("hex"));
  });

  it("advertises its readiness and auth mode on /healthz", async () => {
    const res = await app.inject({ method: "GET", url: "/healthz" });
    const body = res.json();
    expect(body.read_only).toBe(true);
    expect(body.tools).toEqual(["search", "fetch"]);
    expect(body.auth).toBe("loopback-only");
  });
});
