import { z } from "zod";
import { advancedRoute } from "./advanced-router.js";
import { CapabilityRegistry, capabilityKindSchema, operationSchema, type Capability } from "./capability-registry.js";
import { evaluateHardPolicy } from "./policy.js";

export const unifiedRouteRequestSchema = z.object({
  project: z.string().min(1),
  task: z.string().min(1),
  operation: operationSchema.default("READ"),
  sensitivity: z.enum(["public", "standard", "restricted"]).default("standard"),
  complexity: z.enum(["deterministic", "simple", "complex"]).default("simple"),
  cost_preference: z.enum(["lowest", "balanced", "quality"]).default("balanced"),
  kinds: z.array(capabilityKindSchema).min(1).optional(),
  required_tags: z.array(z.string().min(1)).default([]),
  preferred_tags: z.array(z.string().min(1)).default([]),
  include_planned: z.boolean().default(false),
  limit: z.number().int().min(1).max(20).default(5)
});

export type UnifiedRouteRequest = z.infer<typeof unifiedRouteRequestSchema>;

type ScoredCapability = Capability & { score: number; score_reasons: string[] };

function scoreCapability(capability: Capability, request: UnifiedRouteRequest): ScoredCapability {
  let score = capability.priority;
  const reasons = [`priority:${capability.priority}`];
  const preferred = new Set(request.preferred_tags);

  const matchedPreferred = capability.tags.filter((tag) => preferred.has(tag));
  if (matchedPreferred.length) {
    const bonus = matchedPreferred.length * 8;
    score += bonus;
    reasons.push(`preferred_tags:+${bonus}`);
  }

  if (request.complexity === "deterministic") {
    if (capability.kind === "DETERMINISTIC") { score += 40; reasons.push("deterministic_fit:+40"); }
    else { score -= 25; reasons.push("deterministic_mismatch:-25"); }
  }

  if (request.complexity === "complex") {
    if (capability.kind === "MODEL" || capability.kind === "AGENT") { score += 20; reasons.push("complex_reasoning_fit:+20"); }
    if (capability.kind === "DETERMINISTIC") { score -= 10; reasons.push("complex_reasoning_mismatch:-10"); }
  }

  if (request.cost_preference === "lowest" && capability.kind === "DETERMINISTIC") {
    score += 20;
    reasons.push("lowest_cost_fit:+20");
  }

  if (request.sensitivity === "restricted") {
    if (capability.kind === "MODEL") { score -= 15; reasons.push("restricted_model_penalty:-15"); }
    if (capability.kind === "DETERMINISTIC") { score += 10; reasons.push("restricted_local_bonus:+10"); }
  }

  if (capability.risk === "HIGH") { score -= 12; reasons.push("high_risk_penalty:-12"); }
  else if (capability.risk === "MEDIUM") { score -= 4; reasons.push("medium_risk_penalty:-4"); }

  return { ...capability, score, score_reasons: reasons };
}

export function unifiedRoute(registry: CapabilityRegistry, input: UnifiedRouteRequest) {
  const request = unifiedRouteRequestSchema.parse(input);
  const policy = evaluateHardPolicy({ project: request.project, operation: request.operation });

  if (policy.disposition !== "ALLOW") {
    return {
      selected: null,
      candidates: [],
      disposition: "HUMAN_REVIEW" as const,
      reason: policy.reason,
      policy
    };
  }

  const legacyTier = advancedRoute({
    project: request.project,
    task: request.task,
    sensitivity: request.sensitivity,
    complexity: request.complexity,
    cost_preference: request.cost_preference,
    operation: request.operation
  });

  const candidates = registry.candidates({
    project: request.project,
    operation: request.operation,
    kinds: request.kinds,
    requiredTags: request.required_tags,
    includePlanned: request.include_planned
  }).map((capability) => scoreCapability(capability, request))
    .sort((a, b) => b.score - a.score || b.priority - a.priority || a.id.localeCompare(b.id))
    .slice(0, request.limit);

  if (!candidates.length) {
    return {
      selected: null,
      candidates: [],
      disposition: "NO_MATCH" as const,
      reason: "NO_ELIGIBLE_CAPABILITY",
      policy,
      legacy_tier: legacyTier.tier
    };
  }

  return {
    selected: candidates[0],
    candidates,
    disposition: "ROUTE" as const,
    reason: "HIGHEST_ELIGIBLE_SCORE",
    policy,
    legacy_tier: legacyTier.tier
  };
}
