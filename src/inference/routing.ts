import { deepseekRuntimeDefaults, groqRuntimeDefaults, type RuntimeConfig } from "../config.js";

export type InferenceProviderId = "groq" | "deepseek" | "openrouter";
export type InferenceTask = "fast" | "reasoning" | "frontier";

/**
 * Deterministic task → provider order (MODEL_ROUTE: one model per provider, see modelFor).
 * No runtime probing: policy decides the chain, the breaker only removes a provider.
 */
export const TASK_ROUTE: Record<InferenceTask, readonly InferenceProviderId[]> = {
  fast: ["groq", "deepseek"],
  reasoning: ["deepseek", "groq"],
  frontier: ["openrouter", "deepseek", "groq"]
};

export type FrontierPolicy = { allowed: boolean; reason: string };

/** Frontier escalation is opt-in per deployment and never available in production. */
export function frontierPolicy(config: RuntimeConfig): FrontierPolicy {
  const ds = deepseekRuntimeDefaults(config);
  if (!ds.inferenceFrontierEnabled) {
    return { allowed: false, reason: "frontier escalation requires INFERENCE_FRONTIER_ENABLED=1" };
  }
  if (config.env === "production") {
    return { allowed: false, reason: "frontier escalation is blocked in production" };
  }
  return { allowed: true, reason: "frontier escalation enabled by policy" };
}

export function modelFor(
  config: RuntimeConfig,
  provider: InferenceProviderId,
  task: InferenceTask
): string {
  const ds = deepseekRuntimeDefaults(config);
  if (provider === "groq") return config.groqModel ?? "openai/gpt-oss-120b";
  if (provider === "deepseek") {
    return task === "reasoning" ? ds.deepseekReasoningModel : ds.deepseekModel;
  }
  return task === "frontier"
    ? ds.openRouterFrontierModel
    : (config.openRouterChatModel ?? ds.openRouterFrontierModel);
}

export type ResolvedRoute = {
  task: InferenceTask;
  chain: InferenceProviderId[];
  /** Non-null when a frontier request was refused by policy (caller must fail closed). */
  blocked: string | null;
  frontier: FrontierPolicy;
};

/**
 * Builds the ordered provider chain for a request.
 * - `provider_preference` puts the named provider first, order otherwise unchanged.
 * - openrouter is the frontier tier: only in the chain when policy allows it (or explicitly requested).
 */
export function resolveRoute(input: {
  config: RuntimeConfig;
  task?: InferenceTask;
  provider_preference?: "auto" | InferenceProviderId;
}): ResolvedRoute {
  const task: InferenceTask = input.task ?? "fast";
  const frontier = frontierPolicy(input.config);
  const preference = input.provider_preference ?? "auto";

  if (task === "frontier" && !frontier.allowed) {
    return { task, chain: [], blocked: frontier.reason, frontier };
  }

  // OpenRouter is the frontier tail: appended only when policy allows it and the legacy
  // GROQ_FALLBACK_OPENROUTER switch is not off.
  const tailAllowed = frontier.allowed && groqRuntimeDefaults(input.config).groqFallbackOpenRouter;
  const base = [...TASK_ROUTE[task]];
  let chain = base.filter((id) => id !== "openrouter" || tailAllowed || preference === "openrouter");
  if (tailAllowed && !chain.includes("openrouter")) chain = [...chain, "openrouter"];
  if (chain.length === 0) chain = [...TASK_ROUTE.reasoning];

  if (preference !== "auto" && !chain.includes(preference)) chain = [...chain, preference];
  const ordered =
    preference === "auto" ? chain : [preference, ...chain.filter((id) => id !== preference)];

  return { task, chain: ordered, blocked: null, frontier };
}
