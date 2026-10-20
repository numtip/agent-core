import { groqRuntimeDefaults, type RuntimeConfig } from "../config.js";
import { assertProviderUsage } from "../inference/usage-validation.js";

export type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type ChatCompletionUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
};

export type ChatCompletionResult = {
  content: string;
  model: string;
  provider: "groq" | "openrouter";
  providerRequestId: string | null;
  usage: ChatCompletionUsage;
};

export type ChatCompletionRequest = {
  messages: ChatMessage[];
  max_tokens?: number;
  temperature?: number;
};

type OpenAiChatPayload = {
  id?: string;
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: Partial<ChatCompletionUsage>;
};

function usageFromPayload(raw: Partial<ChatCompletionUsage> | undefined): ChatCompletionUsage {
  const prompt = typeof raw?.prompt_tokens === "number" ? raw.prompt_tokens : 0;
  const completion = typeof raw?.completion_tokens === "number" ? raw.completion_tokens : 0;
  const total =
    typeof raw?.total_tokens === "number" ? raw.total_tokens : prompt + completion;
  return { prompt_tokens: prompt, completion_tokens: completion, total_tokens: total };
}

async function postChatCompletion(input: {
  url: string;
  apiKey: string;
  model: string;
  provider: "groq" | "openrouter";
  body: ChatCompletionRequest;
  timeoutMs: number;
  fetchImpl: typeof fetch;
}): Promise<ChatCompletionResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await input.fetchImpl(input.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        ...(input.provider === "openrouter"
          ? {
              "HTTP-Referer": "https://github.com/numtip/agent-core",
              "X-Title": "Agent Core Inference"
            }
          : {})
      },
      body: JSON.stringify({
        model: input.model,
        messages: input.body.messages,
        max_tokens: input.body.max_tokens ?? 512,
        temperature: input.body.temperature ?? 0
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const err = new Error(
        `${input.provider} chat completion failed with HTTP ${response.status}`
      ) as Error & { status?: number };
      err.status = response.status;
      throw err;
    }

    const payload = (await response.json()) as OpenAiChatPayload;
    const message = payload.choices?.[0]?.message as
      | { content?: string; reasoning?: string }
      | undefined;
    let content = message?.content;
    if ((!content || content.length === 0) && typeof message?.reasoning === "string") {
      content = message.reasoning;
    }
    if (typeof content !== "string" || content.length === 0) {
      throw new Error(`${input.provider} chat completion returned empty content`);
    }

    const usage = assertProviderUsage(
      usageFromPayload(payload.usage),
      input.provider
    );

    return {
      content,
      model: typeof payload.model === "string" ? payload.model : input.model,
      provider: input.provider,
      providerRequestId: typeof payload.id === "string" ? payload.id : null,
      usage
    };
  } finally {
    clearTimeout(timer);
  }
}

export class GroqChatProvider {
  private readonly groq: ReturnType<typeof groqRuntimeDefaults>;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.groq = groqRuntimeDefaults(config);
  }

  configured(): boolean {
    return Boolean(this.groq.groqEnabled && this.config.groqApiKey);
  }

  async complete(body: ChatCompletionRequest): Promise<ChatCompletionResult> {
    if (!this.configured()) {
      throw new Error("Groq inference is not configured");
    }
    return postChatCompletion({
      url: `${this.groq.groqBaseUrl.replace(/\/$/, "")}/chat/completions`,
      apiKey: this.config.groqApiKey!,
      model: this.groq.groqModel,
      provider: "groq",
      body,
      timeoutMs: this.groq.groqTimeoutMs,
      fetchImpl: this.fetchImpl
    });
  }
}

export class OpenRouterChatProvider {
  private readonly groq: ReturnType<typeof groqRuntimeDefaults>;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {
    this.groq = groqRuntimeDefaults(config);
  }

  configured(): boolean {
    return Boolean(this.config.openRouterApiKey);
  }

  async complete(body: ChatCompletionRequest): Promise<ChatCompletionResult> {
    if (!this.configured()) {
      throw new Error("OpenRouter chat fallback is not configured");
    }
    return postChatCompletion({
      url: this.groq.openRouterChatUrl,
      apiKey: this.config.openRouterApiKey!,
      model: this.groq.openRouterChatModel,
      provider: "openrouter",
      body,
      timeoutMs: this.groq.groqTimeoutMs,
      fetchImpl: this.fetchImpl
    });
  }
}

export function isRetryableHttpStatus(status: number | undefined): boolean {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}
