import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfig } from "../../src/config.js";

export const groqTestDefaults: Pick<
  RuntimeConfig,
  | "groqEnabled"
  | "groqBaseUrl"
  | "groqModel"
  | "groqTimeoutMs"
  | "groqMaxRetries"
  | "groqMonthlyBudgetUsd"
  | "groqCostLedgerPath"
  | "groqUsdPer1MInputTokens"
  | "groqUsdPer1MOutputTokens"
  | "groqFallbackOpenRouter"
  | "openRouterChatUrl"
  | "openRouterChatModel"
> = {
  groqEnabled: false,
  groqBaseUrl: "https://groq.example/v1",
  groqModel: "openai/gpt-oss-120b",
  groqTimeoutMs: 1000,
  groqMaxRetries: 1,
  groqMonthlyBudgetUsd: 10,
  groqCostLedgerPath: null,
  groqUsdPer1MInputTokens: 0.15,
  groqUsdPer1MOutputTokens: 0.6,
  groqFallbackOpenRouter: true,
  openRouterChatUrl: "https://openrouter.example/chat/completions",
  openRouterChatModel: "openai/gpt-oss-120b"
};

export function testRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  return {
    ...groqTestDefaults,
    reaLocalHandoffEnabled: false,
    reaWorkspaceRoots: [],
    reaPackageVersion: "6.4.0",
    reaAllowlistProfile: "v1",
    ...config
  };
}

const testsDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
export const REA_TEST_WORKSPACE = resolve(testsDir, "fixtures", "rea-workspace");
export const REA_SYNTHETIC_APP = resolve(REA_TEST_WORKSPACE, "inbox", "synthetic-app");
