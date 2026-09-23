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

function optionalProbability(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }
  return value;
}

function levelLabel(answer: JsonObject, request: DecisionRequest, index: string): string | null {
  const legend = answer.legend;
  if (legend && typeof legend === "object" && !Array.isArray(legend)) {
    const entry = (legend as JsonObject)[index];
    if (typeof entry === "string") return entry;
    if (entry && typeof entry === "object" && !Array.isArray(entry)) {
      const description = (entry as JsonObject).description;
      if (typeof description === "string") return description;
    }
  }
  if (request.question.type === "score") {
    const fromRequest = request.question.levels[Number(index)];
    if (typeof fromRequest === "string") return fromRequest;
  }
  return null;
}

// Live Decisions API shape (~typesafe/jev-latest, verified 2026-09-23):
//   choice -> { type: "choice", choice: "<label>", probabilities: { label: p }, confidence: p }
//   noul   -> { type: "noul", noul: p }
//   score  -> { type: "score", score: <0..n expected level>, legend: { index: label },
//               probabilities: { index: p }, confidence: p }
function parseChoice(answer: JsonObject, _request: DecisionRequest): JevDecision {
  const raw = answer.choice;

  if (typeof raw === "string") {
    const probabilities = answer.probabilities;
    let confidence = optionalProbability(answer.confidence);
    if (
      confidence === null &&
      probabilities &&
      typeof probabilities === "object" &&
      !Array.isArray(probabilities)
    ) {
      confidence = optionalProbability((probabilities as JsonObject)[raw]);
    }
    if (confidence === null) {
      throw new Error("Jev choice answer carries no usable confidence");
    }
    return { result: raw, confidence, providerRequestId: null };
  }

  const choice = asObject(raw);
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

function parseScore(answer: JsonObject, request: DecisionRequest): JevDecision {
  const probabilities = answer.probabilities;
  if (probabilities && typeof probabilities === "object" && !Array.isArray(probabilities)) {
    const entries = Object.entries(probabilities).map(([key, value]) => [
      key,
      probability(value, key)
    ] as const);

    if (entries.length > 0) {
      entries.sort((a, b) => b[1] - a[1]);
      const [index, topProbability] = entries[0];
      const label = levelLabel(answer, request, index);
      if (label) {
        return {
          result: label,
          confidence: optionalProbability(answer.confidence) ?? topProbability,
          providerRequestId: null
        };
      }
    }
  }

  if (typeof answer.score !== "number" || !Number.isFinite(answer.score)) {
    throw new Error("Invalid Jev score answer");
  }

  // The Decisions API returns `score` as an expected level on an internal scale, so it is
  // only meaningful together with a calibrated confidence. When the provider supplies no
  // confidence, we must not invent certainty: report the failure instead of returning a
  // fabricated 1.0 that would be promoted to an EXECUTE disposition.
  const confidence =
    optionalProbability(answer.confidence) ?? optionalProbability(answer.probability);
  if (confidence === null) {
    throw new Error("Jev score answer carries no calibrated confidence");
  }

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
      if (request.question.type === "choice") parsed = parseChoice(answer, request);
      else if (request.question.type === "noul") parsed = parseNoul(answer);
      else parsed = parseScore(answer, request);

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
