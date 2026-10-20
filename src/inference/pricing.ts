import { groqRuntimeDefaults, type RuntimeConfig } from "../config.js";
import type { ChatCompletionUsage } from "../providers/openai-chat.js";

export type InferencePricingProvider = "groq" | "openrouter";

/** Estimated USD from provider-reported token usage (not invoice/billing API). */
export function estimateUsageCostUsd(
  config: RuntimeConfig,
  usage: ChatCompletionUsage,
  provider: InferencePricingProvider
): number {
  const groq = groqRuntimeDefaults(config);
  const inputRate =
    provider === "groq"
      ? groq.groqUsdPer1MInputTokens
      : (config.openRouterUsdPer1MInputTokens ?? groq.groqUsdPer1MInputTokens);
  const outputRate =
    provider === "groq"
      ? groq.groqUsdPer1MOutputTokens
      : (config.openRouterUsdPer1MOutputTokens ?? groq.groqUsdPer1MOutputTokens);

  const input = (usage.prompt_tokens / 1_000_000) * inputRate;
  const output = (usage.completion_tokens / 1_000_000) * outputRate;
  return Number((input + output).toFixed(8));
}
