import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { InferenceService } from "../src/services/inference.js";

const live =
  process.env.LIVE_GROQ_INFERENCE === "1" && Boolean(process.env.GROQ_API_KEY);

describe.skipIf(!live)("Groq live inference", () => {
  it("calls Groq openai/gpt-oss-120b when configured", async () => {
    const config = loadConfig();

    const service = new InferenceService({
      ...config,
      groqEnabled: true,
      groqCostLedgerPath: null,
      env: "development"
    });

    const result = await service.complete({
      project: "agent-core",
      task_id: "live-smoke",
      messages: [{ role: "user", content: "Reply with exactly: GROQ_OK" }],
      max_tokens: 32,
      temperature: 0,
      provider_preference: "groq"
    });

    expect(result.provider).toBe("groq");
    expect(result.model).toContain("gpt-oss");
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.estimated_cost_usd).toBeGreaterThanOrEqual(0);
  }, 30_000);
});
