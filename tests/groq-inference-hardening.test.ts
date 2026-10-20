import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/app.js";
import { InferenceCostGuard } from "../src/inference/cost-guard.js";
import { estimateUsageCostUsd } from "../src/inference/pricing.js";
import {
  InferencePilotBlockedError,
  InferenceService
} from "../src/services/inference.js";
import { testRuntimeConfig } from "./helpers/test-runtime-config.js";

function okGroqResponse(content = "OK") {
  return new Response(
    JSON.stringify({
      id: "groq-req",
      model: "openai/gpt-oss-120b",
      choices: [{ message: { content } }],
      usage: { prompt_tokens: 80, completion_tokens: 10, total_tokens: 90 }
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
}

describe("Groq inference hardening", () => {
  it("rejects unauthenticated requests when auth is required", async () => {
    const config = testRuntimeConfig({
      env: "test",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: true,
      projectKeys: { "agent-core": "local-token" },
      projectScopes: { "agent-core": ["inference"] },
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqEnabled: true,
      groqApiKey: "gsk-test"
    });
    const app = buildApp({ config });
    const denied = await app.inject({
      method: "POST",
      url: "/v2/inference/complete",
      payload: {
        project: "agent-core",
        messages: [{ role: "user", content: "hi" }]
      }
    });
    expect(denied.statusCode).toBe(401);
    await app.close();
  });

  it("blocks inference on production env (VPS activation blocked)", async () => {
    const config = testRuntimeConfig({
      env: "production",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: true,
      projectKeys: { "agent-core": "local-token" },
      projectScopes: { "agent-core": ["inference"] },
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqEnabled: true,
      groqApiKey: "gsk-test",
      groqCostLedgerPath: null
    });
    const inference = new InferenceService(config, {
      fetchImpl: async () => okGroqResponse()
    });
    await expect(
      inference.complete({
        project: "agent-core",
        messages: [{ role: "user", content: "hi" }]
      })
    ).rejects.toBeInstanceOf(InferencePilotBlockedError);
  });

  it("retries Groq on HTTP 429 then succeeds", async () => {
    let groqCalls = 0;
    const config = testRuntimeConfig({
      env: "test",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: false,
      projectKeys: {},
      projectScopes: {},
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqEnabled: true,
      groqApiKey: "gsk-test",
      groqMaxRetries: 2,
      groqFallbackOpenRouter: false,
      groqCostLedgerPath: null
    });

    const inference = new InferenceService(config, {
      fetchImpl: async (input) => {
        if (String(input).includes("groq.example")) {
          groqCalls += 1;
          if (groqCalls === 1) {
            return new Response("rate limited", { status: 429 });
          }
        }
        return okGroqResponse("RETRY_OK");
      }
    });

    const result = await inference.complete({
      project: "agent-core",
      messages: [{ role: "user", content: "test" }]
    });
    expect(result.content).toBe("RETRY_OK");
    expect(groqCalls).toBe(2);
    expect(result.cost_basis).toBe("estimate_from_provider_usage");
    expect(result.usage.prompt_tokens).toBe(80);
  });

  it("uses provider-specific pricing on OpenRouter fallback", () => {
    const config = testRuntimeConfig({
      env: "test",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: false,
      projectKeys: {},
      projectScopes: {},
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqUsdPer1MInputTokens: 0.1,
      groqUsdPer1MOutputTokens: 0.1,
      openRouterUsdPer1MInputTokens: 0.5,
      openRouterUsdPer1MOutputTokens: 0.5
    });
    const usage = { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 };
    expect(estimateUsageCostUsd(config, usage, "groq")).toBe(0.1);
    expect(estimateUsageCostUsd(config, usage, "openrouter")).toBe(0.5);
  });

  it("serializes concurrent reservations under shared ledger (single process)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "groq-concurrent-"));
    const ledgerPath = join(dir, "ledger.json");
    await writeFile(
      ledgerPath,
      JSON.stringify({
        month: new Date().toISOString().slice(0, 7),
        spent_usd: 0,
        reserved_usd: 0,
        requests: 0,
        tokens: { prompt: 0, completion: 0, total: 0 }
      })
    );

    const config = testRuntimeConfig({
      env: "development",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: false,
      projectKeys: {},
      projectScopes: {},
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqEnabled: true,
      groqApiKey: "gsk-test",
      groqMonthlyBudgetUsd: 0.001,
      groqCostLedgerPath: ledgerPath,
      groqUsdPer1MInputTokens: 1,
      groqUsdPer1MOutputTokens: 1,
      groqFallbackOpenRouter: false
    });

    const inference = new InferenceService(config, {
      fetchImpl: async () => okGroqResponse()
    });

    const results = await Promise.allSettled([
      inference.complete({
        project: "agent-core",
        messages: [{ role: "user", content: "a".repeat(4000) }],
        max_tokens: 512
      }),
      inference.complete({
        project: "agent-core",
        messages: [{ role: "user", content: "b".repeat(4000) }],
        max_tokens: 512
      })
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length + rejected.length).toBe(2);
    expect(rejected.length).toBeGreaterThanOrEqual(1);

    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    expect(ledger.reserved_usd).toBe(0);
    expect(ledger.spent_usd).toBeLessThanOrEqual(config.groqMonthlyBudgetUsd!);
  });

  it("releases reservation when provider fails without fallback", async () => {
    const dir = await mkdtemp(join(tmpdir(), "groq-release-"));
    const ledgerPath = join(dir, "ledger.json");
    const config = testRuntimeConfig({
      env: "test",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: false,
      projectKeys: {},
      projectScopes: {},
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqEnabled: true,
      groqApiKey: "gsk-test",
      groqCostLedgerPath: ledgerPath,
      groqFallbackOpenRouter: false
    });

    const inference = new InferenceService(config, {
      fetchImpl: async () => new Response("fail", { status: 503 })
    });

    await expect(
      inference.complete({
        project: "agent-core",
        messages: [{ role: "user", content: "x" }]
      })
    ).rejects.toThrow(/failed/i);

    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    expect(ledger.reserved_usd).toBe(0);
    expect(ledger.spent_usd).toBe(0);
  });

  it("fail-closed when ledger path missing outside test env", () => {
    const guard = new InferenceCostGuard(
      testRuntimeConfig({
        env: "development",
        host: "127.0.0.1",
        port: 8787,
        openRouterDecisionsUrl: "https://example.invalid",
        jevModel: "~typesafe/jev-latest",
        requestTimeoutMs: 1000,
        confidenceExecute: 0.85,
        confidenceReview: 0.6,
        authRequired: false,
        projectKeys: {},
        projectScopes: {},
        rateLimitMax: 100,
        rateLimitWindowMs: 60000,
        auditLogPath: null,
        playwrightMcpExecutionEnabled: false,
        playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
        playwrightMcpTimeoutMs: 5000,
        groqApiKey: "gsk-test",
        groqCostLedgerPath: null
      })
    );
    expect(() => guard.assertLedgerConfigured()).toThrow(/GROQ_COST_LEDGER/);
  });

  it("returns GET /v2/inference/budget for authorized project", async () => {
    const config = testRuntimeConfig({
      env: "test",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: true,
      projectKeys: { "agent-core": "local-token" },
      projectScopes: { "agent-core": ["inference"] },
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqEnabled: true,
      groqApiKey: "gsk-test",
      groqCostLedgerPath: null
    });
    const app = buildApp({ config });
    const response = await app.inject({
      method: "GET",
      url: "/v2/inference/budget",
      headers: {
        "x-agent-project": "agent-core",
        "x-agent-project-token": "local-token"
      }
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().cost_basis).toBe("estimate_from_provider_usage");
    expect(response.json().pilot_activation).toBe("dev-only");
    await app.close();
  });

  it("returns HTTP 402 when monthly budget would be exceeded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "groq-402-"));
    const ledgerPath = join(dir, "ledger.json");
    const config = testRuntimeConfig({
      env: "test",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: true,
      projectKeys: { "agent-core": "local-token" },
      projectScopes: { "agent-core": ["inference"] },
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqEnabled: true,
      groqApiKey: "gsk-test",
      groqMonthlyBudgetUsd: 0.000001,
      groqCostLedgerPath: ledgerPath,
      groqUsdPer1MInputTokens: 1,
      groqUsdPer1MOutputTokens: 1,
      groqFallbackOpenRouter: false
    });
    const inference = new InferenceService(config, {
      fetchImpl: async () => okGroqResponse()
    });
    const app = buildApp({ config, inference });
    const response = await app.inject({
      method: "POST",
      url: "/v2/inference/complete",
      headers: {
        "x-agent-project": "agent-core",
        "x-agent-project-token": "local-token"
      },
      payload: {
        project: "agent-core",
        messages: [{ role: "user", content: "x".repeat(8000) }],
        max_tokens: 512
      }
    });
    expect(response.statusCode).toBe(402);
    expect(response.json().error).toBe("INFERENCE_BUDGET_EXCEEDED");
    await app.close();
  });

  it("maps Groq reasoning when message content is empty", async () => {
    const config = testRuntimeConfig({
      env: "test",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: false,
      projectKeys: {},
      projectScopes: {},
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqEnabled: true,
      groqApiKey: "gsk-test",
      groqFallbackOpenRouter: false,
      groqCostLedgerPath: null
    });
    const inference = new InferenceService(config, {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "", reasoning: "REASON_OK" } }],
            usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    });
    const result = await inference.complete({
      project: "agent-core",
      messages: [{ role: "user", content: "hi" }]
    });
    expect(result.content).toBe("REASON_OK");
  });

  it("blocks when GROQ_PILOT_ACTIVATION=blocked", async () => {
    const previous = process.env.GROQ_PILOT_ACTIVATION;
    process.env.GROQ_PILOT_ACTIVATION = "blocked";
    try {
      const config = testRuntimeConfig({
        env: "development",
        host: "127.0.0.1",
        port: 8787,
        openRouterDecisionsUrl: "https://example.invalid",
        jevModel: "~typesafe/jev-latest",
        requestTimeoutMs: 1000,
        confidenceExecute: 0.85,
        confidenceReview: 0.6,
        authRequired: false,
        projectKeys: {},
        projectScopes: {},
        rateLimitMax: 100,
        rateLimitWindowMs: 60000,
        auditLogPath: null,
        playwrightMcpExecutionEnabled: false,
        playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
        playwrightMcpTimeoutMs: 5000,
        groqEnabled: true,
        groqApiKey: "gsk-test",
        groqCostLedgerPath: null
      });
      const inference = new InferenceService(config, {
        fetchImpl: async () => okGroqResponse()
      });
      await expect(
        inference.complete({
          project: "agent-core",
          messages: [{ role: "user", content: "hi" }]
        })
      ).rejects.toBeInstanceOf(InferencePilotBlockedError);

      const app = buildApp({ config });
      const http = await app.inject({
        method: "POST",
        url: "/v2/inference/complete",
        payload: {
          project: "agent-core",
          messages: [{ role: "user", content: "hi" }]
        }
      });
      expect(http.statusCode).toBe(503);
      expect(http.json().error).toBe("GROQ_PILOT_BLOCKED");
      await app.close();
    } finally {
      if (previous === undefined) delete process.env.GROQ_PILOT_ACTIVATION;
      else process.env.GROQ_PILOT_ACTIVATION = previous;
    }
  });

  it("returns HTTP 503 when the cost ledger is corrupt", async () => {
    const dir = await mkdtemp(join(tmpdir(), "groq-corrupt-"));
    const ledgerPath = join(dir, "ledger.json");
    await writeFile(ledgerPath, "{not-json", "utf8");
    const config = testRuntimeConfig({
      env: "test",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: true,
      projectKeys: { "agent-core": "local-token" },
      projectScopes: { "agent-core": ["inference"] },
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqEnabled: true,
      groqApiKey: "gsk-test",
      groqCostLedgerPath: ledgerPath,
      groqFallbackOpenRouter: false
    });
    const app = buildApp({
      config,
      inference: new InferenceService(config, { fetchImpl: async () => okGroqResponse() })
    });
    const response = await app.inject({
      method: "POST",
      url: "/v2/inference/complete",
      headers: {
        "x-agent-project": "agent-core",
        "x-agent-project-token": "local-token"
      },
      payload: {
        project: "agent-core",
        messages: [{ role: "user", content: "hi" }]
      }
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("INFERENCE_LEDGER_UNAVAILABLE");
    await app.close();
  });

  it("returns HTTP 503 when provider usage is ambiguous and does not bill", async () => {
    const dir = await mkdtemp(join(tmpdir(), "groq-ambiguous-"));
    const ledgerPath = join(dir, "ledger.json");
    const config = testRuntimeConfig({
      env: "test",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: true,
      projectKeys: { "agent-core": "local-token" },
      projectScopes: { "agent-core": ["inference"] },
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqEnabled: true,
      groqApiKey: "gsk-test",
      groqCostLedgerPath: ledgerPath,
      groqFallbackOpenRouter: false
    });
    const app = buildApp({
      config,
      inference: new InferenceService(config, {
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              choices: [{ message: { content: "X" } }],
              usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 3 }
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
      })
    });
    const response = await app.inject({
      method: "POST",
      url: "/v2/inference/complete",
      headers: {
        "x-agent-project": "agent-core",
        "x-agent-project-token": "local-token"
      },
      payload: {
        project: "agent-core",
        messages: [{ role: "user", content: "hi" }]
      }
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toBe("INFERENCE_USAGE_AMBIGUOUS");
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    expect(ledger.spent_usd).toBe(0);
    expect(ledger.reserved_usd).toBe(0);
    await app.close();
  });
});
