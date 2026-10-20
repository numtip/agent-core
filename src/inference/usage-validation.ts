import type { ChatCompletionUsage } from "../providers/openai-chat.js";

export class InferenceUsageAmbiguousError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferenceUsageAmbiguousError";
  }
}

export function assertProviderUsage(
  usage: ChatCompletionUsage,
  provider: "groq" | "openrouter"
): ChatCompletionUsage {
  const { prompt_tokens, completion_tokens, total_tokens } = usage;
  if (
    !Number.isInteger(prompt_tokens) ||
    !Number.isInteger(completion_tokens) ||
    !Number.isInteger(total_tokens) ||
    prompt_tokens < 0 ||
    completion_tokens < 0 ||
    total_tokens < 0
  ) {
    throw new InferenceUsageAmbiguousError(
      `${provider} returned non-integer or negative token usage`
    );
  }
  if (total_tokens === 0 && prompt_tokens + completion_tokens > 0) {
    throw new InferenceUsageAmbiguousError(`${provider} returned inconsistent token totals`);
  }
  if (total_tokens > 0 && total_tokens < prompt_tokens + completion_tokens) {
    throw new InferenceUsageAmbiguousError(`${provider} total_tokens is less than sum of parts`);
  }
  return usage;
}
