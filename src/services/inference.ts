import { deepseekRuntimeDefaults, groqRuntimeDefaults, type RuntimeConfig } from "../config.js";
import {
  InferenceBudgetExceededError,
  InferenceCostGuard,
  InferenceLedgerCorruptError
} from "../inference/cost-guard.js";
import {
  assertProviderUsage,
  InferenceUsageAmbiguousError
} from "../inference/usage-validation.js";
import { isGroqPilotRouteAllowed, groqPilotBlockReason } from "../inference/pilot-guard.js";
import { capCompletionTokens, estimatePromptTokens } from "../inference/prompt-estimate.js";
import { estimateUsageCostUsd } from "../inference/pricing.js";
import { InferenceCircuitBreaker } from "../inference/circuit-breaker.js";
import { frontierPolicy, modelFor, resolveRoute, type InferenceProviderId } from "../inference/routing.js";
import type { InferenceCompleteRequest, InferenceCompleteResponse } from "../inference/schemas.js";
import {
  DeepSeekChatProvider,
  GroqChatProvider,
  OpenRouterChatProvider,
  isRetryableHttpStatus,
  sleep,
  type ChatCompletionRequest,
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

export class InferenceFrontierBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InferenceFrontierBlockedError";
  }
}

type ChainProvider = {
  configured(): boolean;
  complete(body: ChatCompletionRequest, modelOverride?: string): Promise<ChatCompletionResult>;
};

export class InferenceService {
  private readonly providers: Record<InferenceProviderId, ChainProvider>;
  private readonly costGuard: InferenceCostGuard;
  private readonly groqDefaults: ReturnType<typeof groqRuntimeDefaults>;
  private readonly breaker: InferenceCircuitBreaker;

  constructor(
    private readonly config: RuntimeConfig,
    deps?: {
      groq?: ChainProvider;
      deepseek?: ChainProvider;
      openRouter?: ChainProvider;
      costGuard?: InferenceCostGuard;
      circuitBreaker?: InferenceCircuitBreaker;
      fetchImpl?: typeof fetch;
    }
  ) {
    const fetchImpl = deps?.fetchImpl ?? fetch;
    this.groqDefaults = groqRuntimeDefaults(config);
    const ds = deepseekRuntimeDefaults(config);
    this.providers = {
      groq: deps?.groq ?? new GroqChatProvider(config, fetchImpl),
      deepseek: deps?.deepseek ?? new DeepSeekChatProvider(config, fetchImpl),
      openrouter: deps?.openRouter ?? new OpenRouterChatProvider(config, fetchImpl)
    };
    this.costGuard = deps?.costGuard ?? new InferenceCostGuard(config);
    this.breaker =
      deps?.circuitBreaker ??
      new InferenceCircuitBreaker(
        ds.inferenceCircuitFailureThreshold,
        ds.inferenceCircuitCooldownMs
      );
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
      groq_enabled: this.providers.groq.configured(),
      deepseek_enabled: this.providers.deepseek.configured(),
      openrouter_fallback_configured: this.providers.openrouter.configured(),
      frontier_escalation: frontierPolicy(this.config).allowed ? "enabled" : "blocked",
      circuit_breakers: this.breaker.snapshot(),
      overspend_blocked: ledger.overspend_blocked,
      cost_basis: "estimate_from_provider_usage" as const,
      pilot_activation: isGroqPilotRouteAllowed(this.config) ? "dev-only" : "blocked"
    };
  }

  private completionCap(request: InferenceCompleteRequest): number {
    return capCompletionTokens(
      request.max_tokens,
      this.config.groqMaxCompletionTokens ?? 1024
    );
  }

  private reserveUsdForRequest(
    request: InferenceCompleteRequest,
    chain: InferenceProviderId[]
  ): number {
    const promptTokens = estimatePromptTokens(request);
    const completionTokens = this.completionCap(request);
    const usage = {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    };
    // Reserve the worst case across the planned chain: any provider may serve the request.
    return chain.reduce(
      (max, provider) => Math.max(max, estimateUsageCostUsd(this.config, usage, provider)),
      0
    );
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
        if (
          error instanceof InferenceUsageAmbiguousError ||
          error instanceof InferenceLedgerCorruptError ||
          error instanceof InferenceBudgetExceededError
        ) {
          throw error;
        }
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

    const route = resolveRoute({
      config: this.config,
      task: request.task,
      provider_preference: request.provider_preference
    });
    if (route.blocked) throw new InferenceFrontierBlockedError(route.blocked);

    const preference = request.provider_preference ?? "auto";
    if (preference !== "auto" && !this.providers[preference].configured()) {
      throw new InferenceUnavailableError(
        `${preference} provider requested but not configured`
      );
    }

    // A frontier task without a configured frontier provider would silently downgrade: fail closed.
    if (route.task === "frontier" && !this.providers.openrouter.configured()) {
      throw new InferenceUnavailableError(
        "frontier task requires a configured openrouter provider"
      );
    }

    const candidates = route.chain.filter(
      (provider) => this.providers[provider].configured() && this.breaker.allow(provider)
    );
    if (candidates.length === 0) {
      throw new InferenceUnavailableError(
        `No inference provider is available for route ${route.chain.join(",")}`
      );
    }

    const maxTokens = this.completionCap(request);
    const body: ChatCompletionRequest = {
      messages: request.messages,
      max_tokens: maxTokens,
      temperature: request.temperature
    };

    const ledgerBefore = await this.costGuard.readLedger();
    const reserveUsd = this.reserveUsdForRequest(request, candidates);
    await this.costGuard.reserveBudget(reserveUsd);

    let result: ChatCompletionResult | null = null;
    let attempts = 0;

    try {
      for (const provider of candidates) {
        if (!this.breaker.allow(provider)) continue;
        try {
          const model = modelFor(this.config, provider, route.task);
          result = await this.completeWithRetries(async () => {
            attempts += 1;
            return this.providers[provider].complete(body, model);
          });
          this.breaker.recordSuccess(provider);
          break;
        } catch (error) {
          this.breaker.recordFailure(provider);
          if (
            error instanceof InferenceBudgetExceededError ||
            error instanceof InferenceUsageAmbiguousError ||
            error instanceof InferenceLedgerCorruptError
          ) {
            throw error;
          }
        }
      }

      if (!result) {
        throw new InferenceUnavailableError("Inference failed for all providers");
      }

      const fallback = result.provider !== candidates[0];
      const usage = assertProviderUsage(result.usage, result.provider);
      result = { ...result, usage };
      const costUsd = estimateUsageCostUsd(this.config, usage, result.provider);
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
        task: route.task,
        route: candidates,
        usage: result.usage,
        estimated_cost_usd: costUsd,
        cost_basis: "estimate_from_provider_usage",
        pricing_provider: result.provider,
        budget: {
          month: ledgerAfter.month,
          spent_usd: ledgerAfter.spent_usd,
          remaining_usd: this.costGuard.budgetRemainingUsd(ledgerAfter),
          budget_usd: this.groqDefaults.groqMonthlyBudgetUsd,
          overspend_blocked: ledgerAfter.overspend_blocked
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
