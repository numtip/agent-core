import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildApp } from "../src/app.js";
import { InferenceService } from "../src/services/inference.js";
import { groqTestDefaults, testRuntimeConfig } from "./helpers/test-runtime-config.js";

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
  groqMaxRetries: 1
});

describe("Groq inference route", () => {
  it("requires inference scope", async () => {
    const config = testRuntimeConfig({
      ...baseConfig,
      projectScopes: { "agent-core": ["metrics"] }
    });
    const app = buildApp({ config });
    const denied = await app.inject({
      method: "POST",
      url: "/v2/inference/complete",
      headers: {
        "x-agent-project": "agent-core",
        "x-agent-project-token": "local-token"
      },
      payload: {
        project: "agent-core",
        messages: [{ role: "user", content: "Reply with OK only." }]
      }
    });
    expect(denied.statusCode).toBe(403);
    await app.close();
  });

  it("completes via Groq and records cost ledger", async () => {
    const dir = await mkdtemp(join(tmpdir(), "groq-ledger-"));
    const ledgerPath = join(dir, "ledger.json");
    const config = testRuntimeConfig({
      ...baseConfig,
      groqCostLedgerPath: ledgerPath
    });

    const fakeFetch: typeof fetch = async (input) => {
      const url = String(input);
      expect(url).toContain("groq.example");
      return new Response(
        JSON.stringify({
          id: "groq-req-1",
          model: "openai/gpt-oss-120b",
          choices: [{ message: { content: "OK" } }],
          usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const inference = new InferenceService(config, { fetchImpl: fakeFetch });
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
        task_id: "bench-1",
        messages: [{ role: "user", content: "Reply with OK only." }],
        max_tokens: 32
      }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.provider).toBe("groq");
    expect(body.fallback).toBe(false);
    expect(body.content).toBe("OK");
    expect(body.estimated_cost_usd).toBeGreaterThan(0);

    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    expect(ledger.requests).toBe(1);
    expect(ledger.spent_usd).toBeGreaterThan(0);
    await app.close();
  });

  it("falls back to OpenRouter chat when Groq fails", async () => {
    const config = testRuntimeConfig({
      ...baseConfig,
      groqFallbackOpenRouter: true
    });

    let calls = 0;
    const fakeFetch: typeof fetch = async (input) => {
      calls += 1;
      const url = String(input);
      if (url.includes("groq.example")) {
        return new Response("upstream error", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          id: "or-chat-1",
          model: "openai/gpt-oss-120b",
          choices: [{ message: { content: "FALLBACK_OK" } }],
          usage: { prompt_tokens: 50, completion_tokens: 4, total_tokens: 54 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const inference = new InferenceService(config, { fetchImpl: fakeFetch });
    const result = await inference.complete({
      project: "agent-core",
      messages: [{ role: "user", content: "Say FALLBACK_OK" }],
      provider_preference: "auto"
    });

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.provider).toBe("openrouter");
    expect(result.fallback).toBe(true);
    expect(result.content).toBe("FALLBACK_OK");
  });

  it("blocks when monthly budget would be exceeded", async () => {
    const dir = await mkdtemp(join(tmpdir(), "groq-budget-"));
    const ledgerPath = join(dir, "ledger.json");
    const config = testRuntimeConfig({
      ...baseConfig,
      groqMonthlyBudgetUsd: 0.000001,
      groqCostLedgerPath: ledgerPath,
      groqUsdPer1MInputTokens: 1,
      groqUsdPer1MOutputTokens: 1
    });

    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "X" } }],
          usage: { prompt_tokens: 5000, completion_tokens: 5000, total_tokens: 10000 }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const inference = new InferenceService(config, { fetchImpl: fakeFetch });
    await expect(
      inference.complete({
        project: "agent-core",
        messages: [{ role: "user", content: "test" }],
        provider_preference: "auto"
      })
    ).rejects.toThrow(/budget/i);
  });
});

describe("groqTestDefaults", () => {
  it("keeps Jev/OpenRouter paths separate from Groq chat", () => {
    expect(groqTestDefaults.groqModel).toBe("openai/gpt-oss-120b");
    expect(groqTestDefaults.openRouterChatUrl).toContain("openrouter");
  });
});
