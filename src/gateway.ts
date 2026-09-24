import { z } from "zod";
import { CapabilityRegistry, capabilityKindSchema, operationSchema, type Capability } from "./capability-registry.js";
import { evaluateHardPolicy } from "./policy.js";
import { unifiedRoute, unifiedRouteRequestSchema } from "./unified-router.js";

export const capabilitySearchSchema = z.object({
  project: z.string().min(1),
  operation: operationSchema.default("READ"),
  query: z.string().default(""),
  kinds: z.array(capabilityKindSchema).optional(),
  required_tags: z.array(z.string().min(1)).default([]),
  include_planned: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(10),
  disclosure_level: z.enum(["summary", "schema", "full"]).default("summary")
});

export const executeRequestSchema = z.object({
  project: z.string().min(1),
  task: z.string().min(1),
  operation: operationSchema.default("READ"),
  sensitivity: z.enum(["public", "standard", "restricted"]).default("standard"),
  complexity: z.enum(["deterministic", "simple", "complex"]).default("simple"),
  cost_preference: z.enum(["lowest", "balanced", "quality"]).default("balanced"),
  capability_id: z.string().min(1).optional(),
  required_tags: z.array(z.string().min(1)).default([]),
  preferred_tags: z.array(z.string().min(1)).default([]),
  environment: z.enum(["local", "preview", "production"]).default("local"),
  targets: z.array(z.string()).default([]),
  input: z.record(z.string(), z.unknown()).default({})
});

export type ExecuteRequest = z.infer<typeof executeRequestSchema>;

export type CapabilitySummary = Pick<Capability, "id"|"kind"|"description"|"tags"|"operations"|"risk"|"status">;

function summary(capability: Capability): CapabilitySummary {
  return {
    id: capability.id,
    kind: capability.kind,
    description: capability.description,
    tags: capability.tags,
    operations: capability.operations,
    risk: capability.risk,
    status: capability.status
  };
}

export function discloseCapability(capability: Capability, level: "summary"|"schema"|"full" = "summary") {
  if (level === "summary") return summary(capability);
  if (level === "schema") {
    return {
      ...summary(capability),
      input_contract: capability.metadata.input_contract ?? null,
      output_contract: capability.metadata.output_contract ?? null,
      execution_mode: capability.metadata.execution_mode ?? "HANDOFF"
    };
  }
  return capability;
}

export function searchCapabilities(registry: CapabilityRegistry, raw: unknown) {
  const request = capabilitySearchSchema.parse(raw);
  const query = request.query.trim().toLowerCase();
  const candidates = registry.candidates({
    project: request.project,
    operation: request.operation,
    kinds: request.kinds,
    requiredTags: request.required_tags,
    includePlanned: request.include_planned
  });
  const filtered = query ? candidates.filter((capability) => {
    const haystack = [capability.id, capability.description, ...capability.tags].join(" ").toLowerCase();
    return haystack.includes(query);
  }) : candidates;

  return {
    schema_version: 2,
    disclosure_level: request.disclosure_level,
    count: Math.min(filtered.length, request.limit),
    capabilities: filtered.slice(0, request.limit).map((item) => discloseCapability(item, request.disclosure_level))
  };
}

function executionMode(capability: Capability): "LOCAL"|"HANDOFF"|"UNAVAILABLE" {
  if (capability.status !== "ACTIVE") return "UNAVAILABLE";
  const configured = capability.metadata.execution_mode;
  if (configured === "LOCAL" || configured === "HANDOFF") return configured;
  return capability.metadata.executor === "agent-core" ? "LOCAL" : "HANDOFF";
}

export function interceptExecution(registry: CapabilityRegistry, raw: unknown) {
  const request = executeRequestSchema.parse(raw);
  const policy = evaluateHardPolicy({
    project: request.project,
    operation: request.operation,
    targets: request.targets,
    environment: request.environment
  });

  if (policy.disposition !== "ALLOW") {
    return {
      disposition: "APPROVAL_REQUIRED" as const,
      executed: false,
      selected: null,
      reason: policy.reason,
      policy
    };
  }

  let selected: Capability | undefined;
  let route: ReturnType<typeof unifiedRoute> | null = null;

  if (request.capability_id) {
    selected = registry.get(request.capability_id);
    if (!selected || selected.status !== "ACTIVE") {
      return { disposition:"UNAVAILABLE" as const, executed:false, selected:null, reason:"CAPABILITY_NOT_ACTIVE", policy };
    }
    const eligible = registry.candidates({ project:request.project, operation:request.operation }).some((item) => item.id === selected?.id);
    if (!eligible) return { disposition:"DENIED" as const, executed:false, selected:null, reason:"CAPABILITY_NOT_ELIGIBLE", policy };
  } else {
    const routeRequest = unifiedRouteRequestSchema.parse({
      project: request.project,
      task: request.task,
      operation: request.operation,
      sensitivity: request.sensitivity,
      complexity: request.complexity,
      cost_preference: request.cost_preference,
      required_tags: request.required_tags,
      preferred_tags: request.preferred_tags
    });
    route = unifiedRoute(registry, routeRequest);
    selected = route.selected ?? undefined;
    if (!selected) return { disposition:"NO_ROUTE" as const, executed:false, selected:null, reason:route.reason, policy, route };
  }

  const mode = executionMode(selected);
  if (mode === "UNAVAILABLE") {
    return { disposition:"UNAVAILABLE" as const, executed:false, selected:summary(selected), reason:"CAPABILITY_UNAVAILABLE", policy, route };
  }

  // V2-2 intentionally does not impersonate project-side agents or external tools.
  // The gateway produces a policy-checked execution contract. Local handlers are added explicitly per capability.
  return {
    disposition: mode === "LOCAL" ? "READY_LOCAL" as const : "HANDOFF" as const,
    executed: false,
    selected: discloseCapability(selected, "schema"),
    reason: mode === "LOCAL" ? "LOCAL_EXECUTOR_REQUIRED" : "CLIENT_OR_ADAPTER_HANDOFF",
    policy,
    route,
    execution: {
      mode,
      capability_id: selected.id,
      input: request.input
    }
  };
}
