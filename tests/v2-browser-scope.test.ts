import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { RuntimeConfig } from "../src/config.js";
import type { JevProvider } from "../src/providers/jev.js";

const base: RuntimeConfig = {
  env: "test", host: "127.0.0.1", port: 8787, openRouterApiKey: "test-key",
  openRouterDecisionsUrl: "https://example.invalid/decisions", jevModel: "~typesafe/jev-latest",
  requestTimeoutMs: 1000, confidenceExecute: 0.85, confidenceReview: 0.6, authRequired: true,
  projectKeys: { handbook: "secret", goffice2026: "secret2", dbplant: "secret3" },
  projectScopes: {
    handbook: ["route"],
    goffice2026: ["route", "browser"],
    dbplant: ["route"],
  },
  rateLimitMax: 1000, rateLimitWindowMs: 60000, auditLogPath: null,playwrightMcpExecutionEnabled:false,playwrightMcpEndpoint:"http://127.0.0.1:8791/mcp",playwrightMcpTimeoutMs:5000
};
const provider = { decide: async () => ({ result: "x", confidence: 0.9, providerRequestId: "x" }) } as unknown as JevProvider;

describe("V2 gateway browser scope enforcement", () => {
  it("denies a browser-class capability without the explicit browser scope", async () => {
    const app = buildApp({ config: base, provider });
    const response = await app.inject({
      method: "POST", url: "/v2/execute",
      headers: { "x-agent-project": "handbook", "x-agent-project-token": "secret" },
      payload: { project: "handbook", task: "read a page", operation: "READ", capability_id: "mcp.playwright" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().scope).toBe("browser");
    await app.close();
  });

  it("denies the same capability for a database project (browser disabled)", async () => {
    const app = buildApp({ config: base, provider });
    const response = await app.inject({
      method: "POST", url: "/v2/execute",
      headers: { "x-agent-project": "dbplant", "x-agent-project-token": "secret3" },
      payload: { project: "dbplant", task: "read a page", operation: "READ", capability_id: "mcp.playwright" },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("still issues the handoff contract when the browser scope is granted", async () => {
    const app = buildApp({ config: base, provider });
    const response = await app.inject({
      method: "POST", url: "/v2/execute",
      headers: { "x-agent-project": "goffice2026", "x-agent-project-token": "secret2" },
      payload: { project: "goffice2026", task: "read a page", operation: "READ", capability_id: "mcp.playwright" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().disposition).toBe("HANDOFF");
    expect(response.json().executed).toBe(false);
    await app.close();
  });

  it("does not gate non-browser capabilities on the browser scope", async () => {
    const app = buildApp({ config: base, provider });
    const response = await app.inject({
      method: "POST", url: "/v2/execute",
      headers: { "x-agent-project": "handbook", "x-agent-project-token": "secret" },
      payload: { project: "handbook", task: "validate checksums", capability_id: "deterministic.runtime" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().disposition).toBe("READY_LOCAL");
    await app.close();
  });
});
