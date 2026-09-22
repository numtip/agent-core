import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../src/config.js";
import type { JevDecision, JevProvider } from "../src/providers/jev.js";
import type { DecisionRequest } from "../src/schemas.js";
import {
  DecisionService,
  DecisionUnavailableError
} from "../src/services/decision.js";

const config: RuntimeConfig = {
  host: "127.0.0.1",
  port: 8787,
  openRouterApiKey: "test",
  openRouterDecisionsUrl: "https://example.invalid",
  jevModel: "~typesafe/jev-latest",
  requestTimeoutMs: 1000,
  confidenceExecute: 0.85,
  confidenceReview: 0.60,
  env: "test",
  authRequired: false,
  projectKeys: {},
  projectScopes: {},
  rateLimitMax: 100,
  rateLimitWindowMs: 60000,
  auditLogPath: null
};

const baseRequest: DecisionRequest = {
  project: "52clips",
  task_id: "GO-01",
  decision_type: "NEXT_ACTION",
  state: { subtitle: "missing" },
  question: {
    type: "choice",
    instructions: "Choose the next safe action.",
    criteria: {
      GENERATE_SUBTITLE: "Subtitle is missing.",
      READY_FOR_QA: "All required assets are present."
    }
  },
  fallback_result: "HUMAN_REVIEW"
};

function providerReturning(value: JevDecision): JevProvider {
  return {
    decide: async () => value
  } as unknown as JevProvider;
}

describe("DecisionService", () => {
  it("allows high-confidence decisions to execute", async () => {
    const service = new DecisionService(
      config,
      providerReturning({
        result: "GENERATE_SUBTITLE",
        confidence: 0.96,
        providerRequestId: "req-1"
      })
    );

    const result = await service.decide(baseRequest);
    expect(result.disposition).toBe("EXECUTE");
    expect(result.fallback).toBe(false);
  });

  it("requires review for medium-confidence decisions", async () => {
    const service = new DecisionService(
      config,
      providerReturning({
        result: "GENERATE_SUBTITLE",
        confidence: 0.72,
        providerRequestId: "req-2"
      })
    );

    const result = await service.decide(baseRequest);
    expect(result.disposition).toBe("REVIEW");
    expect(result.reason_code).toBe("LOW_CONFIDENCE_REVIEW");
  });

  it("uses the declared safe fallback for low confidence", async () => {
    const service = new DecisionService(
      config,
      providerReturning({
        result: "READY_FOR_QA",
        confidence: 0.40,
        providerRequestId: "req-3"
      })
    );

    const result = await service.decide(baseRequest);
    expect(result.result).toBe("HUMAN_REVIEW");
    expect(result.disposition).toBe("FALLBACK");
    expect(result.fallback).toBe(true);
  });

  it("uses fallback when the provider fails", async () => {
    const provider = {
      decide: async () => {
        throw new Error("provider down");
      }
    } as unknown as JevProvider;

    const service = new DecisionService(config, provider);
    const result = await service.decide(baseRequest);

    expect(result.result).toBe("HUMAN_REVIEW");
    expect(result.reason_code).toBe("PROVIDER_UNAVAILABLE");
  });

  it("fails safely if provider fails and no fallback exists", async () => {
    const provider = {
      decide: async () => {
        throw new Error("provider down");
      }
    } as unknown as JevProvider;

    const service = new DecisionService(config, provider);

    await expect(
      service.decide({ ...baseRequest, fallback_result: undefined })
    ).rejects.toBeInstanceOf(DecisionUnavailableError);
  });
});
