import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config.js";
import { InferenceService } from "../src/services/inference.js";

// Opt-in only: LIVE_MULTI_PROVIDER_INFERENCE=1 with GROQ_API_KEY + DEEPSEEK_API_KEY in env.
const live =
  process.env.LIVE_MULTI_PROVIDER_INFERENCE === "1" &&
  Boolean(process.env.GROQ_API_KEY) &&
  Boolean(process.env.DEEPSEEK_API_KEY);

describe.skipIf(!live)("multi-provider live inference", () => {
  it("routes fast to Groq and reasoning to DeepSeek", async () => {
    const dir = await mkdtemp(join(tmpdir(), "live-ledger-"));
    const service = new InferenceService({
      ...loadConfig(),
      env: "development",
      groqEnabled: true,
      deepseekEnabled: true,
      groqCostLedgerPath: join(dir, "ledger.json")
    });

    const fast = await service.complete({
      project: "agent-core",
      task_id: "live-fast",
      task: "fast",
      messages: [{ role: "user", content: "Reply with exactly: FAST_OK" }],
      // gpt-oss-120b spends completion tokens on reasoning first; <64 leaves content empty.
      max_tokens: 128,
      temperature: 0
    });
    expect(fast.provider).toBe("groq");
    expect(fast.content.length).toBeGreaterThan(0);

    const reasoning = await service.complete({
      project: "agent-core",
      task_id: "live-reasoning",
      task: "reasoning",
      messages: [{ role: "user", content: "Reply with exactly: REASON_OK" }],
      max_tokens: 64,
      temperature: 0
    });
    expect(reasoning.provider).toBe("deepseek");
    expect(reasoning.content.length).toBeGreaterThan(0);
    expect(reasoning.estimated_cost_usd).toBeGreaterThanOrEqual(0);
  }, 90_000);
});
