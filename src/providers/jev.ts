import type { RuntimeConfig } from "../config.js";
import type { DecisionRequest } from "../schemas.js";

export type JevDecision = {
  result: string;
  confidence: number;
  providerRequestId: string | null;
};

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected object in Jev response");
  }
  return value as JsonObject;
}

function probability(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`Invalid probability for ${label}`);
  }
  return value;
}

function buildQuestion(request: DecisionRequest): JsonObject {
  const q = request.question;

  if (q.type === "choice") {
    return {
      type: "choice",
      instructions: q.instructions,
      criteria: q.criteria
    };
  }

  if (q.type === "noul") {
    return {
      type: "noul",
      instructions: q.instructions,
      criteria: {
        true: q.true_when,
        false: q.false_when
      }
    };
  }

  return {
    type: "score",
    instructions: q.instructions,
    criteria: q.levels
  };
}

function parseChoice(answer: JsonObject): JevDecision {
  const choice = asObject(answer.choice);
  const entries = Object.entries(choice).map(([key, value]) => [
    key,
    probability(value, key)
  ] as const);

  if (entries.length === 0) {
    throw new Error("Jev choice answer contains no options");
  }

  entries.sort((a, b) => b[1] - a[1]);
  return {
    result: entries[0][0],
    confidence: entries[0][1],
    providerRequestId: null
  };
}

function parseNoul(answer: JsonObject): JevDecision {
  const yes = probability(answer.noul, "noul");
  const isTrue = yes >= 0.5;
  return {
    result: isTrue ? "true" : "false",
    confidence: isTrue ? yes : 1 - yes,
    providerRequestId: null
  };
}

function parseScore(answer: JsonObject): JevDecision {
  if (typeof answer.score !== "number" || !Number.isFinite(answer.score)) {
    throw new Error("Invalid Jev score answer");
  }

  // Some Decisions API responses expose an optional probability/confidence.
  // Treat absence as 1.0 only for transport parsing; policy consumers should
  // calibrate score decisions independently before autonomous execution.
  const confidence =
    typeof answer.probability === "number"
      ? probability(answer.probability, "score")
      : 1;

  return {
    result: String(answer.score),
    confidence,
    providerRequestId: null
  };
}

export class JevProvider {
  constructor(
    private readonly config: RuntimeConfig,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async decide(request: DecisionRequest): Promise<JevDecision> {
    if (!this.config.openRouterApiKey) {
      throw new Error("OPENROUTER_API_KEY is not configured");
    }

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      this.config.requestTimeoutMs
    );

    try {
      const response = await this.fetchImpl(this.config.openRouterDecisionsUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.openRouterApiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: this.config.jevModel,
          state: request.state,
          questions: {
            decision: buildQuestion(request)
          }
        }),
        signal: controller.signal
      });

      if (!response.ok) {
        throw new Error(
          `OpenRouter Decisions API failed with HTTP ${response.status}`
        );
      }

      const payload = asObject(await response.json());
      const answers = asObject(payload.answers);
      const answer = asObject(answers.decision);

      let parsed: JevDecision;
      if (request.question.type === "choice") parsed = parseChoice(answer);
      else if (request.question.type === "noul") parsed = parseNoul(answer);
      else parsed = parseScore(answer);

      return {
        ...parsed,
        providerRequestId:
          typeof payload.id === "string" ? payload.id : null
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
