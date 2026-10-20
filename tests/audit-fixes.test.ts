import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { loadConfig, type RuntimeConfig } from "../src/config.js";
import { planBrowserAction } from "../src/browser-control.js";
import type { JevProvider } from "../src/providers/jev.js";

const provider = {
  decide: async () => ({ result: "OK", confidence: 0.9, providerRequestId: "jev-test" }),
} as unknown as JevProvider;

function config(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    env: "test", host: "127.0.0.1", port: 8787, openRouterApiKey: "test-key",
    openRouterDecisionsUrl: "https://example.invalid/decisions", jevModel: "~typesafe/jev-latest",
    requestTimeoutMs: 1000, confidenceExecute: 0.85, confidenceReview: 0.6, authRequired: true,
    projectKeys: { "52clips": "secret-52", handbook: "secret-hb" },
    projectScopes: { "52clips": ["route"], handbook: ["route"] },
    rateLimitMax: 1000, rateLimitWindowMs: 60000, auditLogPath: null,
    playwrightMcpExecutionEnabled: false, playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
    playwrightMcpTimeoutMs: 5000,
    ...overrides,
  };
}

describe("auth: prototype property names are not project keys", () => {
  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])("x-agent-project: %s -> 401", async (project) => {
    const app = buildApp({ config: config(), provider });
    const res = await app.inject({
      method: "POST", url: "/v1/decision",
      headers: { "x-agent-project": project, "x-agent-project-token": "x" }, payload: {},
    });
    await app.close();
    expect(res.statusCode).toBe(401);
  });
});

describe("config: malformed JSON never echoes the secret value", () => {
  const saved = process.env.AGENT_CORE_PROJECT_KEYS;
  afterEach(() => {
    if (saved === undefined) delete process.env.AGENT_CORE_PROJECT_KEYS;
    else process.env.AGENT_CORE_PROJECT_KEYS = saved;
  });

  it("throws a sanitized error", () => {
    process.env.AGENT_CORE_PROJECT_KEYS = "{52clips:tok-should-not-leak}";
    expect(() => loadConfig()).toThrowError(/AGENT_CORE_PROJECT_KEYS must be valid JSON/);
    try { loadConfig(); } catch (error) {
      expect(String((error as Error).message)).not.toContain("tok-should-not-leak");
    }
  });
});

describe("subagent completion is bound to the calling project", () => {
  const plan = { goal: "render subtitles", candidate_agents: ["subtitle"] };

  it("another project cannot complete a foreign subgoal", async () => {
    const app = buildApp({ config: config(), provider });
    const owner = { "x-agent-project": "52clips", "x-agent-project-token": "secret-52" };
    const other = { "x-agent-project": "handbook", "x-agent-project-token": "secret-hb" };

    const first = await app.inject({ method: "POST", url: "/v1/subagent", headers: owner, payload: { project: "52clips", ...plan } });
    const key = first.json().dedupe_key as string;
    expect(key.startsWith("52clips:")).toBe(true);

    const foreign = await app.inject({ method: "POST", url: "/v1/subagent/complete", headers: other, payload: { key } });
    expect(foreign.statusCode).toBe(403);
    const stillActive = await app.inject({ method: "POST", url: "/v1/subagent", headers: owner, payload: { project: "52clips", ...plan } });
    expect(stillActive.json().duplicate).toBe(true);

    const own = await app.inject({ method: "POST", url: "/v1/subagent/complete", headers: owner, payload: { key } });
    expect(own.statusCode).toBe(200);
    const again = await app.inject({ method: "POST", url: "/v1/subagent", headers: owner, payload: { project: "52clips", ...plan } });
    expect(again.json().duplicate).toBe(false);
    await app.close();
  });
});

describe("browser SSRF guard covers non-RFC1918 internal ranges", () => {
  it.each([
    "http://0.0.0.1/", "http://100.64.0.1/", "http://100.127.255.254/", "http://192.0.0.8/",
    "http://198.18.0.1/", "http://224.0.0.1/", "http://255.255.255.255/", "http://[::7f00:1]/",
  ])("%s is denied", (url) => {
    const plan = planBrowserAction({ project: "handbook", url, action: "BROWSER_READ" });
    expect(plan.disposition).toBe("DENY");
    expect(plan.reason).toBe("PRIVATE_OR_LOCAL_HOST_BLOCKED");
  });

  it.each(["https://example.com/", "http://100.63.255.1/", "http://100.128.0.1/", "http://8.8.8.8/"])("%s stays allowed", (url) => {
    expect(planBrowserAction({ project: "handbook", url, action: "BROWSER_READ" }).disposition).toBe("READY");
  });
});
