import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDefaultCapabilityRegistry } from "../src/capability-registry.js";
import { searchCapabilities } from "../src/gateway.js";
import type { RuntimeConfig } from "../src/config.js";
import type { JevProvider } from "../src/providers/jev.js";
import { findProject } from "../src/projects.js";

const provider = {
  decide: async () => ({ result: "RUN_TESTS", confidence: 0.92, providerRequestId: "jev-test" }),
} as unknown as JevProvider;

const config: RuntimeConfig = {
  env: "test",
  host: "127.0.0.1",
  port: 8787,
  openRouterApiKey: "test-key",
  openRouterDecisionsUrl: "https://example.invalid/decisions",
  jevModel: "~typesafe/jev-latest",
  requestTimeoutMs: 1000,
  confidenceExecute: 0.85,
  confidenceReview: 0.6,
  authRequired: true,
  projectKeys: { "agent-core": "local-dev-token" },
  projectScopes: { "agent-core": ["decision", "route", "qa", "context", "metrics"] },
  rateLimitMax: 1000,
  rateLimitWindowMs: 60000,
  auditLogPath: null,
  playwrightMcpExecutionEnabled: false,
  playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
  playwrightMcpTimeoutMs: 5000,
};

const headers = {
  "x-agent-project": "agent-core",
  "x-agent-project-token": "local-dev-token",
};

describe("agent-core knowledge integration", () => {
  it("registers observation capabilities for search", () => {
    const registry = createDefaultCapabilityRegistry();
    const obs = searchCapabilities(registry, {
      project: "agent-core",
      operation: "READ",
      query: "observation",
      disclosure_level: "summary",
    });
    expect(obs.capabilities.some((c) => c.id === "knowledge.observation")).toBe(true);
    expect(findProject("agent-core")?.defaultScopes).toContain("context");
  });

  it("returns HANDOFF for knowledge query without evidence", async () => {
    const app = buildApp({ config, provider });
    const response = await app.inject({
      method: "POST",
      url: "/v2/knowledge/query",
      headers,
      payload: { project: "agent-core", query: "architecture", sources: ["observation"], memory_repositories: [] },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().disposition).toBe("HANDOFF");
    await app.close();
  });
});
