export type RuntimeConfig = {
  host: string;
  port: number;
  openRouterApiKey?: string;
  openRouterDecisionsUrl: string;
  jevModel: string;
  requestTimeoutMs: number;
  confidenceExecute: number;
  confidenceReview: number;
};

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error(`${name} must be a number`);
  }
  return value;
}

export function loadConfig(): RuntimeConfig {
  return {
    host: process.env.AGENT_CORE_HOST ?? "127.0.0.1",
    port: numberFromEnv("AGENT_CORE_PORT", 8787),
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    openRouterDecisionsUrl:
      process.env.OPENROUTER_DECISIONS_URL ??
      "https://openrouter.ai/api/alpha/decisions",
    jevModel: "~typesafe/jev-latest",
    requestTimeoutMs: numberFromEnv("OPENROUTER_TIMEOUT_MS", 8000),
    confidenceExecute: numberFromEnv("CONFIDENCE_EXECUTE", 0.85),
    confidenceReview: numberFromEnv("CONFIDENCE_REVIEW", 0.60)
  };
}
