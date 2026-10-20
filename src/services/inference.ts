import { groqRuntimeDefaults, type RuntimeConfig } from "../config.js";
import { InferenceBudgetExceededError, InferenceCostGuard } from "../inference/cost-guard.js";
import { isGroqPilotRouteAllowed, groqPilotBlockReason } from "../inference/pilot-guard.js";
import { estimatePromptTokens } from "../inference/prompt-estimate.js";
import { estimateUsageCostUsd } from "../inference/pricing.js";
import type { InferenceCompleteRequest, InferenceCompleteResponse } from "../inference/schemas.js";
import {
  GroqChatProvider,
  OpenRouterChatProvider,
  isRetryableHttpStatus,
  sleep,
  type ChatCompletionResult
} from "../providers/openai-chat.js";

export class InferenceUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "InferenceUnavailableError";
  }
}

export class InferencePilotBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferencePilotBlockedError";
  }
}

export class InferenceService {
  private readonly groq: GroqChatProvider;
  private readonly openRouter: OpenRouterChatProvider;
  private readonly costGuard: InferenceCostGuard;
  private readonly groqDefaults: ReturnType<typeof groqRuntimeDefaults>;

  constructor(
    private readonly config: RuntimeConfig,
    deps?: {
      groq?: GroqChatProvider;
      openRouter?: OpenRouterChatProvider;
      costGuard?: InferenceCostGuard;
      fetchImpl?: typeof fetch;
    }
  ) {
    const fetchImpl = deps?.fetchImpl ?? fetch;
    this.groqDefaults = groqRuntimeDefaults(config);
    this.groq = deps?.groq ?? new GroqChatProvider(config, fetchImpl);
    this.openRouter =
      deps?.openRouter ?? new OpenRouterChatProvider(config, fetchImpl);
    this.costGuard = deps?.costGuard ?? new InferenceCostGuard(config);
  }

  private assertPilotAllowed(): void {
    if (!isGroqPilotRouteAllowed(this.config)) {
      throw new InferencePilotBlockedError(groqPilotBlockReason(this.config));
    }
  }

  async budgetStatus() {
    this.assertPilotAllowed();
    const ledger = await this.costGuard.readLedger();
    return {
      month: ledger.month,
      budget_usd: this.groqDefaults.groqMonthlyBudgetUsd,
      spent_usd: ledger.spent_usd,
      reserved_usd: ledger.reserved_usd,
      remaining_usd: this.costGuard.budgetRemainingUsd(ledger),
      requests: ledger.requests,
      tokens: ledger.tokens,
      groq_enabled: this.groq.configured(),
      openrouter_fallback_configured: this.openRouter.configured(),
      cost_basis: "estimate_from_provider_usage" as const,
      pilot_activation: isGroqPilotRouteAllowed(this.config) ? "dev-only" : "blocked"
    };
  }

  private reserveUsdForRequest(request: InferenceCompleteRequest): number {
    const promptTokens = estimatePromptTokens(request);
    const completionTokens = request.max_tokens ?? 512;
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    };
    const groqReserve = estimateUsageCostUsd(this.config, usage, "groq");
    if (
      this.groqDefaults.groqFallbackOpenRouter &&
      this.openRouter.configured()
    ) {
      const orReserve = estimateUsageCostUsd(this.config, usage, "openrouter");
      return Math.max(groqReserve, orReserve);
    }
    return groqReserve;
  }

  private async completeWithRetries(
    attempt: () => Promise<ChatCompletionResult>
  ): Promise<ChatCompletionResult> {
    const maxAttempts = Math.max(1, this.groqDefaults.groqMaxRetries + 1);
    let lastError: unknown;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await attempt();
      } catch (error) {
        lastError = error;
        const status =
          error && typeof error === "object" && "status" in error
            ? Number((error as { status?: number }).status)
            : undefined;
        const retryable =
          error instanceof Error &&
          (error.name === "AbortError" || isRetryableHttpStatus(status));
        if (!retryable || i >= maxAttempts - 1) break;
        await sleep(200 * 2 ** i);
      }
    }

    throw lastError;
  }

  async complete(request: InferenceCompleteRequest): Promise<InferenceCompleteResponse> {
    this.assertPilotAllowed();

    if (!this.groq.configured() && !this.openRouter.configured()) {
      throw new InferenceUnavailableError("No inference provider is configured");
    }

    const body = {
      messages: request.messages,
      max_tokens: request.max_tokens,
      temperature: request.temperature
    };

    const ledgerBefore = await this.costGuard.readLedger();
    const reserveUsd = this.reserveUsdForRequest(request);
    await this.costGuard.reserveBudget(reserveUsd);

    let result: ChatCompletionResult | null = null;
    let fallback = false;
    let attempts = 0;

    const preference = request.provider_preference ?? "auto";
    const preferGroq = preference !== "openrouter";

    if (preference === "groq" && !this.groq.configured()) {
      await this.costGuard.releaseReservation(reserveUsd);
      throw new InferenceUnavailableError("Groq provider requested but not configured");
    }

    try {
      if (preferGroq && this.groq.configured()) {
        try {
          result = await this.completeWithRetries(async () => {
            attempts += 1;
            return this.groq.complete(body);
          });
        } catch (error) {
          if (
            !this.groqDefaults.groqFallbackOpenRouter ||
            !this.openRouter.configured()
          ) {
            if (error instanceof InferenceBudgetExceededError) throw error;
            throw new InferenceUnavailableError("Groq inference failed", error);
          }
        }
      }

      if (!result && this.openRouter.configured()) {
        fallback = preferGroq && this.groq.configured();
        result = await this.completeWithRetries(async () => {
          attempts += 1;
          return this.openRouter.complete(body);
        });
      }

      if (!result) {
        throw new InferenceUnavailableError("Inference failed for all providers");
      }

      const costUsd = estimateUsageCostUsd(this.config, result.usage, result.provider);
      const ledgerAfter = await this.costGuard.settleReservation(
        reserveUsd,
        costUsd,
        result.usage
      );

      return {
        content: result.content,
        provider: result.provider,
        model: result.model,
        fallback,
        usage: result.usage,
        estimated_cost_usd: costUsd,
        cost_basis: "estimate_from_provider_usage",
        pricing_provider: result.provider,
        budget: {
          month: ledgerAfter.month,
          spent_usd: ledgerAfter.spent_usd,
          remaining_usd: this.costGuard.budgetRemainingUsd(ledgerAfter),
          budget_usd: this.groqDefaults.groqMonthlyBudgetUsd
        },
        provider_request_id: result.providerRequestId,
        attempts,
        ledger_before_usd: ledgerBefore.spent_usd
      };
    } catch (error) {
      await this.costGuard.releaseReservation(reserveUsd);
      throw error;
    }
  }
}
