import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildApp } from "../src/app.js";
import { InferenceService, InferenceFrontierBlockedError } from "../src/services/inference.js";
import { InferenceCircuitBreaker } from "../src/inference/circuit-breaker.js";
import { TASK_ROUTE, modelFor, resolveRoute } from "../src/inference/routing.js";
import { estimateUsageCostUsd } from "../src/inference/pricing.js";
import { testRuntimeConfig } from "./helpers/test-runtime-config.js";
import type { RuntimeConfig } from "../src/config.js";
import type { ChatCompletionResult } from "../src/providers/openai-chat.js";

const baseConfig = testRuntimeConfig({
  env: "test",
  host: "127.0.0.1",
  port: 8787,
  openRouterApiKey: "or-key",
  openRouterDecisionsUrl: "https://openrouter.example/decisions",
  jevModel: "~typesafe/jev-latest",
  requestTimeoutMs: 1000,
  confidenceExecute: 0.85,
  confidenceReview: 0.6,
  authRequired: true,
  projectKeys: { "agent-core": "local-token" },
  projectScopes: { "agent-core": ["inference", "metrics"] },
  rateLimitMax: 100,
  rateLimitWindowMs: 60000,
  auditLogPath: null,
  playwrightMcpExecutionEnabled: false,
  playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
  playwrightMcpTimeoutMs: 5000,
  groqEnabled: true,
  groqApiKey: "gsk-test",
  groqMaxRetries: 0,
  deepseekEnabled: true,
  deepseekApiKey: "ds-test",
  deepseekBaseUrl: "https://deepseek.example",
  deepseekModel: "deepseek-flash"
});

const upstream = (content: string): typeof fetch => async () => ok(content);

function recordingFetch(handler: (url: string) => Response | null) {
  const calls: string[] = [];
  const impl: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    const response = handler(url);
    if (!response) throw new Error(`unexpected url ${url}`);
    return response;
  };
  return { calls, impl };
}

function ok(content: string, model = "m"): Response {
  return new Response(
    JSON.stringify({
      id: `${content}-req`,
      model,
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 20, completion_tokens: 4, total_tokens: 24 }
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

function bad(): Response {
  return new Response("upstream down", { status: 503 });
}

describe("inference task routing", () => {
  it("keeps task chains deterministic", () => {
    expect(TASK_ROUTE.fast).toEqual(["groq", "deepseek"]);
    expect(TASK_ROUTE.reasoning).toEqual(["deepseek", "groq"]);
    expect(TASK_ROUTE.frontier).toEqual(["openrouter", "deepseek", "groq"]);
  });

  it("puts an explicit provider preference first without reordering the rest", () => {
    const route = resolveRoute({
      config: baseConfig,
      task: "reasoning",
      provider_preference: "groq"
    });
    expect(route.chain).toEqual(["groq", "deepseek"]);
  });

  it("appends the frontier tail only when policy allows it", () => {
    const gated = resolveRoute({ config: baseConfig, task: "fast" });
    expect(gated.chain).toEqual(["groq", "deepseek"]);
    expect(gated.frontier.allowed).toBe(false);

    const enabled = resolveRoute({
      config: { ...baseConfig, inferenceFrontierEnabled: true },
      task: "fast"
    });
    expect(enabled.chain).toEqual(["groq", "deepseek", "openrouter"]);
  });

  it("fails closed for a frontier task while the policy is off", () => {
    const route = resolveRoute({ config: baseConfig, task: "frontier" });
    expect(route.chain).toEqual([]);
    expect(route.blocked).toContain("INFERENCE_FRONTIER_ENABLED");
  });

  it("blocks the frontier tier in production even when the flag is on", () => {
    const route = resolveRoute({
      config: { ...baseConfig, env: "production", inferenceFrontierEnabled: true },
      task: "frontier"
    });
    expect(route.blocked).toContain("production");
  });
});

describe("inference multi-provider service", () => {
  it("serves a reasoning task with DeepSeek and does not call Groq", async () => {
    const { calls, impl } = recordingFetch((url) => (url.includes("deepseek.example") ? ok("DS_OK", "deepseek-flash") : null));
    const service = new InferenceService(baseConfig, { fetchImpl: impl });

    const result = await service.complete({
      project: "agent-core",
      task: "reasoning",
      messages: [{ role: "user", content: "Say DS_OK" }]
    });

    expect(result.provider).toBe("deepseek");
    expect(result.model).toBe("deepseek-flash");  // upstream echo of the model we requested
    expect(result.task).toBe("reasoning");
    expect(result.route).toEqual(["deepseek", "groq"]);
    expect(result.fallback).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("deepseek.example");
  });

  it("falls back to Groq when DeepSeek is unavailable", async () => {
    const { calls, impl } = recordingFetch((url) =>
      url.includes("deepseek.example") ? bad() : ok("GROQ_OK")
    );
    const service = new InferenceService(baseConfig, { fetchImpl: impl });

    const result = await service.complete({
      project: "agent-core",
      task: "reasoning",
      messages: [{ role: "user", content: "Say GROQ_OK" }]
    });

    expect(result.provider).toBe("groq");
    expect(result.fallback).toBe(true);
    expect(calls.some((url) => url.includes("deepseek.example"))).toBe(true);
    expect(calls.some((url) => url.includes("groq.example"))).toBe(true);
  });

  it("skips a provider whose circuit breaker is open", async () => {
    const { calls, impl } = recordingFetch((url) =>
      url.includes("deepseek.example") ? bad() : ok("GROQ_OK")
    );
    const breaker = new InferenceCircuitBreaker(1, 60_000);
    await breaker.recordFailure("deepseek");
    const service = new InferenceService(baseConfig, { fetchImpl: impl, circuitBreaker: breaker });

    const result = await service.complete({
      project: "agent-core",
      task: "reasoning",
      messages: [{ role: "user", content: "Say GROQ_OK" }]
    });

    expect(result.provider).toBe("groq");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("groq.example");
  });

  it("fails loudly when an explicitly preferred provider is not configured", async () => {
    const service = new InferenceService(
      { ...baseConfig, deepseekEnabled: false, deepseekApiKey: "" } as RuntimeConfig,
      { fetchImpl: upstream("NOPE") }
    );

    await expect(
      service.complete({
        project: "agent-core",
        provider_preference: "deepseek",
        messages: [{ role: "user", content: "hi" }]
      })
    ).rejects.toThrow(/deepseek provider requested but not configured/);
  });

  it("rejects a frontier task without the policy gate", async () => {
    const service = new InferenceService(baseConfig, { fetchImpl: upstream("NOPE") });
    await expect(
      service.complete({
        project: "agent-core",
        task: "frontier",
        messages: [{ role: "user", content: "hi" }]
      })
    ).rejects.toBeInstanceOf(InferenceFrontierBlockedError);
  });

  it("refuses a frontier task when no frontier provider is configured", async () => {
    const service = new InferenceService(
      { ...baseConfig, openRouterApiKey: "", inferenceFrontierEnabled: true } as RuntimeConfig,
      { fetchImpl: upstream("NOPE") }
    );
    await expect(
      service.complete({
        project: "agent-core",
        task: "frontier",
        messages: [{ role: "user", content: "hi" }]
      })
    ).rejects.toThrow(/frontier task requires a configured openrouter provider/);
  });

  it("answers 403 INFERENCE_FRONTIER_BLOCKED on the HTTP route", async () => {
    const app = buildApp({
      config: baseConfig,
      inference: new InferenceService(baseConfig, { fetchImpl: upstream("NOPE") })
    });

    const response = await app.inject({
      method: "POST",
      url: "/v2/inference/complete",
      headers: { "x-agent-project": "agent-core", "x-agent-project-token": "local-token" },
      payload: {
        project: "agent-core",
        task: "frontier",
        messages: [{ role: "user", content: "hi" }]
      }
    });

    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("INFERENCE_FRONTIER_BLOCKED");
    await app.close();
  });

  it("prices the frontier tier with the OpenRouter rates", () => {
    const config: RuntimeConfig = {
      ...baseConfig,
      openRouterUsdPer1MInputTokens: 0.9,
      openRouterUsdPer1MOutputTokens: 0.9,
      deepseekUsdPer1MInputTokens: 0.2,
      deepseekUsdPer1MOutputTokens: 0.2
    };
    const usage = { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 };
    expect(estimateUsageCostUsd(config, usage, "openrouter")).toBe(0.9);
    expect(estimateUsageCostUsd(config, usage, "deepseek")).toBe(0.2);
  });
});

describe("circuit breaker", () => {
  it("opens after the threshold and allows a trial after the cooldown", async () => {
    let now = 1_000;
    const breaker = new InferenceCircuitBreaker(2, 5_000, { now: () => now });

    expect(await breaker.allow("groq")).toBe(true);
    await breaker.recordFailure("groq");
    expect(await breaker.allow("groq")).toBe(true);
    await breaker.recordFailure("groq");
    expect(await breaker.allow("groq")).toBe(false);
    expect((await breaker.snapshot()).groq).toEqual({ failures: 2, open: true });

    now += 5_001;
    expect(await breaker.allow("groq")).toBe(true);

    await breaker.recordSuccess("groq");
    expect((await breaker.snapshot()).groq).toBeUndefined();
  });

  it("shares failures between two instances through the state file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "breaker-shared-"));
    const statePath = join(dir, "ledger-breakers.json");
    const a = new InferenceCircuitBreaker(2, 60_000, { statePath });
    const b = new InferenceCircuitBreaker(2, 60_000, { statePath });

    await a.recordFailure("deepseek");
    await b.recordFailure("deepseek"); // a different process would see the first failure
    expect(await a.allow("deepseek")).toBe(false);

    await b.recordSuccess("deepseek");
    expect(await a.allow("deepseek")).toBe(true);
  });

  it("treats a corrupt state file as all-closed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "breaker-corrupt-"));
    const statePath = join(dir, "ledger-breakers.json");
    await writeFile(statePath, "{not json", "utf8");
    const breaker = new InferenceCircuitBreaker(1, 60_000, { statePath });
    expect(await breaker.allow("groq")).toBe(true);
  });
});

describe("model route", () => {
  it("routes the reasoning task to the DeepSeek reasoning model", () => {
    expect(modelFor(baseConfig, "deepseek", "reasoning")).toBe("deepseek-v4-pro");
    expect(modelFor(baseConfig, "deepseek", "fast")).toBe("deepseek-flash");
  });

  it("passes the routed model to the provider call", async () => {
    const seen: string[] = [];
    const fake: ChatCompletionResult = {
      content: "OK",
      model: "deepseek-flash",
      provider: "deepseek",
      providerRequestId: null,
      usage: { prompt_tokens: 5, completion_tokens: 1, total_tokens: 6 }
    };
    const service = new InferenceService(baseConfig, {
      deepseek: {
        configured: () => true,
        complete: async (_body, model) => {
          seen.push(model ?? "none");
          return fake;
        }
      }
    });

    await service.complete({
      project: "agent-core",
      task: "reasoning",
      messages: [{ role: "user", content: "hi" }]
    });

    expect(seen).toEqual(["deepseek-v4-pro"]);
  });
});
