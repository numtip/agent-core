import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { RuntimeConfig } from "../src/config.js";
import type { JevProvider } from "../src/providers/jev.js";
import { findProject } from "../src/projects.js";

const provider = {
  decide: async () => ({ result: "REVIEW", confidence: 0.7, providerRequestId: "jev-test-req" }),
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
  projectKeys: { "rae-attendance-v2": "lab-token-only" },
  projectScopes: { "rae-attendance-v2": ["decision"] },
  rateLimitMax: 1000,
  rateLimitWindowMs: 60000,
  auditLogPath: null,
  playwrightMcpExecutionEnabled: false,
  playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
  playwrightMcpTimeoutMs: 5000,
};

const decisionBody = {
  project: "rae-attendance-v2",
  decision_type: "QA_DISPOSITION",
  state: { use_case: "sso_readiness_review", project_context: "rae-attendance-v2" },
  question: {
    type: "choice",
    instructions: "SSO production gate remains NO-GO?",
    criteria: { NO_GO: "Production SSO not approved.", REVIEW: "Needs human review." },
  },
  fallback_result: "defer_to_human",
};

describe("rae-attendance-v2 onboarding (least-privilege scopes)", () => {
  it("is registered in the project profile registry", () => {
    const profile = findProject("rae-attendance-v2");
    expect(profile?.defaultScopes).toEqual(["decision"]);
    expect(profile?.type).toBe("web-application");
  });

  it("allows v1 decision with decision scope only", async () => {
    const app = buildApp({ config, provider });
    const response = await app.inject({
      method: "POST",
      url: "/v1/decision",
      headers: {
        "x-agent-project": "rae-attendance-v2",
        "x-agent-project-token": "lab-token-only",
      },
      payload: decisionBody,
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().provider_request_id).toBe("jev-test-req");
    await app.close();
  });

  it("denies v2 route without route scope", async () => {
    const app = buildApp({ config, provider });
    const response = await app.inject({
      method: "POST",
      url: "/v2/route",
      headers: {
        "x-agent-project": "rae-attendance-v2",
        "x-agent-project-token": "lab-token-only",
      },
      payload: decisionBody,
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("denies browser execute without browser scope", async () => {
    const app = buildApp({ config, provider });
    const response = await app.inject({
      method: "POST",
      url: "/v2/browser/execute",
      headers: {
        "x-agent-project": "rae-attendance-v2",
        "x-agent-project-token": "lab-token-only",
      },
      payload: { project: "rae-attendance-v2", task: "noop", operation: "READ" },
    });
    expect(response.statusCode).toBe(403);
    await app.close();
  });

  it("rejects cross-project spoofing", async () => {
    const app = buildApp({ config, provider });
    const response = await app.inject({
      method: "POST",
      url: "/v1/decision",
      headers: {
        "x-agent-project": "rae-attendance-v2",
        "x-agent-project-token": "lab-token-only",
      },
      payload: { ...decisionBody, project: "goffice2026" },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("PROJECT_MISMATCH");
    await app.close();
  });
});
