import { describe, expect, it } from "vitest";
import type { RuntimeConfig } from "../src/config.js";
import { JevProvider } from "../src/providers/jev.js";
import type { DecisionRequest } from "../src/schemas.js";

const config: RuntimeConfig = {
  host: "127.0.0.1",
  port: 8787,
  openRouterApiKey: "test-key",
  openRouterDecisionsUrl: "https://openrouter.example/decisions",
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

describe("JevProvider", () => {
  it("selects the highest-probability choice", async () => {
    const fakeFetch: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.model).toBe("~typesafe/jev-latest");
      expect(body.questions.decision.type).toBe("choice");

      return new Response(
        JSON.stringify({
          id: "jev-request-1",
          answers: {
            decision: {
              choice: {
                READY: 0.13,
                RETRY: 0.87
              }
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    };

    const request: DecisionRequest = {
      project: "test",
      decision_type: "QA_DISPOSITION",
      state: { tests: "failed" },
      question: {
        type: "choice",
        instructions: "Choose QA disposition.",
        criteria: {
          READY: "All required checks pass.",
          RETRY: "A required check failed."
        }
      }
    };

    const provider = new JevProvider(config, fakeFetch);
    const result = await provider.decide(request);

    expect(result.result).toBe("RETRY");
    expect(result.confidence).toBe(0.87);
    expect(result.providerRequestId).toBe("jev-request-1");
  });

  it("maps noul probability to true/false with calibrated confidence", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          answers: {
            decision: {
              noul: 0.21
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const request: DecisionRequest = {
      project: "test",
      decision_type: "HUMAN_ESCALATION",
      state: { operation: "read_only" },
      question: {
        type: "noul",
        instructions: "Does this require human approval?",
        true_when: "The operation is destructive or production-critical.",
        false_when: "The operation is read-only and reversible."
      }
    };

    const provider = new JevProvider(config, fakeFetch);
    const result = await provider.decide(request);

    expect(result.result).toBe("false");
    expect(result.confidence).toBeCloseTo(0.79);
  });
});
