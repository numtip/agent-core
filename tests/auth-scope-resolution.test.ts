import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { RuntimeConfig } from "../src/config.js";
import type { JevProvider } from "../src/providers/jev.js";

const provider = {
  decide: async () => ({ result: "REVIEW", confidence: 0.7, providerRequestId: "jev-test-req" }),
} as unknown as JevProvider;

const decisionBody = {
  project: "rae-attendance-v2",
  decision_type: "QA_DISPOSITION",
  state: { use_case: "sso_readiness_review" },
  question: {
    type: "choice",
    instructions: "Gate?",
    criteria: { NO_GO: "No.", OK: "Yes." },
  },
  fallback_result: "defer_to_human",
};

function baseConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
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
    projectKeys: { "rae-attendance-v2": "lab-token-only", "52clips": "secret-52" },
    projectScopes: {},
    rateLimitMax: 1000,
    rateLimitWindowMs: 60000,
    auditLogPath: null,
    playwrightMcpExecutionEnabled: false,
    playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
    playwrightMcpTimeoutMs: 5000,
    ...overrides,
  };
}

const headers = {
  "x-agent-project": "rae-attendance-v2",
  "x-agent-project-token": "lab-token-only",
};

describe("auth scope resolution (RB-1 fail-closed)", () => {
  it("uses registry defaultScopes when env omits project (no privilege expansion)", async () => {
    const app = buildApp({ config: baseConfig(), provider });
    const decision = await app.inject({ method: "POST", url: "/v1/decision", headers, payload: decisionBody });
    expect(decision.statusCode).toBe(200);
    const route = await app.inject({ method: "POST", url: "/v2/route", headers, payload: decisionBody });
    expect(route.statusCode).toBe(403);
    const qa = await app.inject({ method: "POST", url: "/v1/qa", headers, payload: decisionBody });
    expect(qa.statusCode).toBe(403);
    const context = await app.inject({ method: "POST", url: "/v1/context", headers, payload: { project: "rae-attendance-v2", candidates: [] } });
    expect(context.statusCode).toBe(403);
    const metrics = await app.inject({ method: "GET", url: "/v1/metrics", headers });
    expect(metrics.statusCode).toBe(403);
    const browser = await app.inject({
      method: "POST",
      url: "/v2/browser/execute",
      headers,
      payload: { project: "rae-attendance-v2", task: "noop", operation: "READ" },
    });
    expect(browser.statusCode).toBe(403);
    await app.close();
  });

  it("denies all guarded routes when env sets an empty scope list", async () => {
    const app = buildApp({
      config: baseConfig({ projectScopes: { "rae-attendance-v2": [] } }),
      provider,
    });
    const decision = await app.inject({ method: "POST", url: "/v1/decision", headers, payload: decisionBody });
    expect(decision.statusCode).toBe(403);
    await app.close();
  });

  it("denies unknown projects with a key but no registry profile", async () => {
    const app = buildApp({
      config: baseConfig({ projectKeys: { "unknown-custom": "tok" }, projectScopes: {} }),
      provider,
    });
    const response = await app.inject({
      method: "POST",
      url: "/v1/decision",
      headers: { "x-agent-project": "unknown-custom", "x-agent-project-token": "tok" },
      payload: { ...decisionBody, project: "unknown-custom" },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("keys-only dbplant denies metrics (registry has no metrics scope)", async () => {
    const app = buildApp({
      config: baseConfig({ projectKeys: { dbplant: "db-tok" } }),
      provider,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics",
      headers: { "x-agent-project": "dbplant", "x-agent-project-token": "db-tok" },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("keys-only attendance-report-generator denies metrics", async () => {
    const app = buildApp({
      config: baseConfig({ projectKeys: { "attendance-report-generator": "att-tok" } }),
      provider,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics",
      headers: {
        "x-agent-project": "attendance-report-generator",
        "x-agent-project-token": "att-tok",
      },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("keys-only 52clips allows metrics (registry includes metrics)", async () => {
    const app = buildApp({
      config: baseConfig({ projectKeys: { "52clips": "clip-tok" } }),
      provider,
    });
    const response = await app.inject({
      method: "GET",
      url: "/v1/metrics",
      headers: { "x-agent-project": "52clips", "x-agent-project-token": "clip-tok" },
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it("preserves explicit env scopes for other projects (52clips)", async () => {
    const app = buildApp({
      config: baseConfig({
        projectScopes: { "52clips": ["decision", "route", "qa", "context", "metrics"] },
      }),
      provider,
    });
    const body = { ...decisionBody, project: "52clips" };
    const response = await app.inject({
      method: "POST",
      url: "/v1/decision",
      headers: { "x-agent-project": "52clips", "x-agent-project-token": "secret-52" },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    await app.close();
  });
});
