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
});
