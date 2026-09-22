import type { RuntimeConfig } from "../config.js";
import type { JevDecision, JevProvider } from "../providers/jev.js";
import type { DecisionRequest, DecisionResponse } from "../schemas.js";

export class DecisionUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "DecisionUnavailableError";
  }
}

function applyConfidencePolicy(
  config: RuntimeConfig,
  request: DecisionRequest,
  decision: JevDecision
): DecisionResponse {
  if (decision.confidence >= config.confidenceExecute) {
    return {
      decision_type: request.decision_type,
      result: decision.result,
      confidence: decision.confidence,
      reason_code: null,
      fallback: false,
      disposition: "EXECUTE",
      provider_request_id: decision.providerRequestId
    };
  }

  if (decision.confidence >= config.confidenceReview) {
    return {
      decision_type: request.decision_type,
      result: decision.result,
      confidence: decision.confidence,
      reason_code: "LOW_CONFIDENCE_REVIEW",
      fallback: false,
      disposition: "REVIEW",
      provider_request_id: decision.providerRequestId
    };
  }

  if (request.fallback_result) {
    return {
      decision_type: request.decision_type,
      result: request.fallback_result,
      confidence: decision.confidence,
      reason_code: "LOW_CONFIDENCE_FALLBACK",
      fallback: true,
      disposition: "FALLBACK",
      provider_request_id: decision.providerRequestId
    };
  }

  return {
    decision_type: request.decision_type,
    result: decision.result,
    confidence: decision.confidence,
    reason_code: "LOW_CONFIDENCE_REVIEW",
    fallback: false,
    disposition: "REVIEW",
    provider_request_id: decision.providerRequestId
  };
}

export class DecisionService {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly provider: JevProvider
  ) {}

  async decide(request: DecisionRequest): Promise<DecisionResponse> {
    try {
      const decision = await this.provider.decide(request);
      return applyConfidencePolicy(this.config, request, decision);
    } catch (error) {
      if (request.fallback_result) {
        return {
          decision_type: request.decision_type,
          result: request.fallback_result,
          confidence: 0,
          reason_code: "PROVIDER_UNAVAILABLE",
          fallback: true,
          disposition: "FALLBACK",
          provider_request_id: null
        };
      }

      throw new DecisionUnavailableError(
        "No safe decision is available and no fallback_result was supplied",
        error
      );
    }
  }
}
