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

  it("parses the live choice answer shape (string choice + probabilities + confidence)", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          id: "gen-dec-123",
          model: "typesafe/jev-1.13-20260917",
          answers: {
            decision: {
              type: "choice",
              choice: "GENERATE_SUBTITLE",
              probabilities: { GENERATE_SUBTITLE: 0.98, READY_FOR_QA: 0, HUMAN_REVIEW: 0.02 },
              confidence: 0.97
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const request: DecisionRequest = {
      project: "52clips",
      decision_type: "NEXT_ACTION",
      state: { visual: "ready", subtitle: "missing" },
      question: {
        type: "choice",
        instructions: "Choose the next safe production action.",
        criteria: {
          GENERATE_SUBTITLE: "Required subtitle is missing.",
          READY_FOR_QA: "All required production assets are present.",
          HUMAN_REVIEW: "State is ambiguous."
        }
      }
    };

    const result = await new JevProvider(config, fakeFetch).decide(request);

    expect(result.result).toBe("GENERATE_SUBTITLE");
    expect(result.confidence).toBe(0.97);
    expect(result.providerRequestId).toBe("gen-dec-123");
  });

  it("prefers the provider probability when confidence is absent (live choice)", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          answers: {
            decision: {
              type: "choice",
              choice: "B",
              probabilities: { A: 0.3, B: 0.7 }
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const request: DecisionRequest = {
      project: "test",
      decision_type: "QA_DISPOSITION",
      state: {},
      question: {
        type: "choice",
        instructions: "Pick one.",
        criteria: { A: "first", B: "second" }
      }
    };

    const result = await new JevProvider(config, fakeFetch).decide(request);
    expect(result.result).toBe("B");
    expect(result.confidence).toBeCloseTo(0.7);
  });

  it("maps the live score answer to a level label with the provider's real confidence", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({
          answers: {
            decision: {
              type: "score",
              score: 0.35,
              legend: { 0: "not started", 1: "partial", 2: "fully ready" },
              probabilities: { 0: 0.76, 1: 0.13, 2: 0.11 },
              confidence: 0.48
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const request: DecisionRequest = {
      project: "52clips",
      decision_type: "QA_DISPOSITION",
      state: {},
      question: {
        type: "score",
        instructions: "Rate pilot readiness.",
        levels: ["not started", "partial", "fully ready"]
      }
    };

    const result = await new JevProvider(config, fakeFetch).decide(request);
    expect(result.result).toBe("not started");
    expect(result.confidence).toBeCloseTo(0.48);
    expect(result.confidence).not.toBe(1);
  });

  it("refuses to invent certainty when a score answer carries no confidence", async () => {
    const fakeFetch: typeof fetch = async () =>
      new Response(
        JSON.stringify({ answers: { decision: { type: "score", score: 1.02 } } }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );

    const request: DecisionRequest = {
      project: "52clips",
      decision_type: "QA_DISPOSITION",
      state: {},
      question: {
        type: "score",
        instructions: "Rate pilot readiness.",
        levels: ["not started", "partial", "fully ready"]
      }
    };

    await expect(new JevProvider(config, fakeFetch).decide(request)).rejects.toThrow(
      /no calibrated confidence/
    );
  });
});
