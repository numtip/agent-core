import type { RuntimeConfig } from "../config.js";
import { detectPromptInjection } from "../browser-control.js";
import { evaluateHardPolicy } from "../policy.js";
import type { DecisionRequest, DecisionResponse } from "../schemas.js";
import type { DecisionService } from "../services/decision.js";
import {
  getAllowlistedTool,
  REA_LOCAL_ALLOWLIST,
  REA_LOCAL_ALLOWLIST_IDS,
  type ReaAllowlistedTool
} from "./allowlist.js";
import { canonicalPathWithinRoots, isUnderSyntheticSample } from "./path-guard.js";
import type { ReaLocalRouteRequest, ReaRouteDisposition } from "./schemas.js";

export type ReaLocalRouteResult = {
  schema_version: 2;
  disposition: ReaRouteDisposition;
  reason: string;
  capability_id: "mcp.rea";
  capability_registry_status: "PLANNED";
  local_handoff_enabled: boolean;
  selected_tool: string | null;
  tool_arguments: Record<string, unknown> | null;
  eligible_tools: string[];
  jev: Pick<
    DecisionResponse,
    "result" | "confidence" | "disposition" | "reason_code" | "fallback" | "provider_request_id"
  > | null;
  policy: { disposition: string; reason: string };
  injection: { detected: boolean; hits: string[] };
  handoff: {
    transport: "CURSOR_MCP";
    namespace: "user-rea";
    tool: string;
    arguments: Record<string, unknown>;
  } | null;
  receipt: {
    receipt_id: string;
    rea_package_version: string;
    workspace_roots: string[];
  };
};

function newReceiptId(): string {
  return `rea_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function validateToolArguments(
  tool: ReaAllowlistedTool,
  raw: Record<string, unknown>,
  workspaceRoots: string[]
): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  if (!REA_LOCAL_ALLOWLIST_IDS.has(tool.id)) {
    return { ok: false, reason: "TOOL_NOT_ALLOWLISTED" };
  }

  const parsed = tool.argumentsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "TOOL_ARGUMENTS_INVALID" };
  }

  if (tool.id === "analyze_javascript_application") {
    const inputPath = String((parsed.data as { input_path: string }).input_path);
    const pathCheck = canonicalPathWithinRoots(inputPath, workspaceRoots);
    if (!pathCheck.ok) return { ok: false, reason: pathCheck.reason };
    const root = workspaceRoots[0];
    if (tool.syntheticSampleOnly && root && !isUnderSyntheticSample(pathCheck.canonicalPath, root)) {
      return { ok: false, reason: "SYNTHETIC_SAMPLE_PATH_REQUIRED" };
    }
    const data = parsed.data as Record<string, unknown>;
    return {
      ok: true,
      args: { ...data, input_path: pathCheck.canonicalPath }
    };
  }

  return { ok: true, args: parsed.data as Record<string, unknown> };
}

function deterministicEligibleTools(request: ReaLocalRouteRequest): string[] {
  const hint = request.tool_hint?.trim();
  if (hint) {
    return REA_LOCAL_ALLOWLIST_IDS.has(hint) ? [hint] : [];
  }

  const args = request.tool_arguments;
  if (typeof args.input_path === "string" && args.input_path.length > 0) {
    return ["analyze_javascript_application"];
  }

  const task = request.task.toLowerCase();
  if (task.includes("session") || task.includes("metadata") || task.includes("binary_session")) {
    return ["binary_session"];
  }

  if (task.includes("javascript") || task.includes("synthetic") || task.includes("analyze")) {
    return ["analyze_javascript_application"];
  }

  return [];
}

function buildJevRequest(
  request: ReaLocalRouteRequest,
  eligible: ReaAllowlistedTool[]
): DecisionRequest {
  const criteria = Object.fromEntries(
    eligible.map((tool) => [tool.id, tool.summary])
  );
  criteria.FALLBACK_DENY = "No allowlisted REA tool fits; deny handoff.";

  return {
    project: request.project,
    task_id: request.task_id,
    decision_type: "TOOL_ROUTE",
    state: {
      task: request.task,
      eligible_tools: eligible.map((t) => t.id),
      tool_arguments_keys: Object.keys(request.tool_arguments)
    },
    question: {
      type: "choice",
      instructions:
        "Choose one allowlisted REA MCP tool id for this bounded local reverse-engineering task. Never invent tools.",
      criteria
    },
    fallback_result: "FALLBACK_DENY"
  };
}

function mapJevToRouteDisposition(jev: DecisionResponse): ReaRouteDisposition {
  if (jev.disposition === "EXECUTE") return "ALLOW_HANDOFF";
  if (jev.disposition === "REVIEW") return "HUMAN_REVIEW";
  return "FALLBACK";
}

export async function routeReaLocalHandoff(input: {
  config: RuntimeConfig;
  request: ReaLocalRouteRequest;
  decisionService: DecisionService;
}): Promise<ReaLocalRouteResult> {
  const { config, request, decisionService } = input;
  const workspaceRoots = config.reaWorkspaceRoots ?? [];
  const injection = detectPromptInjection(
    [request.task, request.untrusted_evidence ?? ""].filter(Boolean).join("\n")
  );

  const baseReceipt = {
    receipt_id: newReceiptId(),
    rea_package_version: config.reaPackageVersion ?? "6.4.0",
    workspace_roots: workspaceRoots
  };

  if (!(config.reaLocalHandoffEnabled ?? false)) {
    return {
      schema_version: 2,
      disposition: "DENY",
      reason: "REA_LOCAL_HANDOFF_DISABLED",
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: false,
      selected_tool: null,
      tool_arguments: null,
      eligible_tools: [],
      jev: null,
      policy: { disposition: "DENY", reason: "REA_LOCAL_HANDOFF_DISABLED" },
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  if (!request.rea_mcp_connected) {
    return {
      schema_version: 2,
      disposition: "UNAVAILABLE",
      reason: "REA_MCP_DISCONNECTED",
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: null,
      tool_arguments: null,
      eligible_tools: [],
      jev: null,
      policy: { disposition: "DENY", reason: "REA_MCP_DISCONNECTED" },
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  if (injection.detected) {
    return {
      schema_version: 2,
      disposition: "HUMAN_REVIEW",
      reason: "PROMPT_INJECTION_SIGNAL",
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: null,
      tool_arguments: null,
      eligible_tools: [],
      jev: null,
      policy: { disposition: "ASK", reason: "PROMPT_INJECTION_SIGNAL" },
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  if (request.tool_hint && !REA_LOCAL_ALLOWLIST_IDS.has(request.tool_hint)) {
    return {
      schema_version: 2,
      disposition: "DENY",
      reason: "TOOL_NOT_ALLOWLISTED",
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: null,
      tool_arguments: null,
      eligible_tools: [],
      jev: null,
      policy: { disposition: "DENY", reason: "TOOL_NOT_ALLOWLISTED" },
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  const eligibleIds = deterministicEligibleTools(request);
  const eligibleTools = eligibleIds
    .map((id) => getAllowlistedTool(id))
    .filter((t): t is ReaAllowlistedTool => Boolean(t));

  if (!eligibleTools.length) {
    return {
      schema_version: 2,
      disposition: "DENY",
      reason: "NO_ELIGIBLE_ALLOWLISTED_TOOL",
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: null,
      tool_arguments: null,
      eligible_tools: [],
      jev: null,
      policy: { disposition: "DENY", reason: "NO_ELIGIBLE_ALLOWLISTED_TOOL" },
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  let jev: DecisionResponse;
  try {
    jev = await decisionService.decide(buildJevRequest(request, eligibleTools));
  } catch {
    return {
      schema_version: 2,
      disposition: "FALLBACK",
      reason: "JEV_UNAVAILABLE",
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: null,
      tool_arguments: null,
      eligible_tools: eligibleIds,
      jev: null,
      policy: { disposition: "DENY", reason: "JEV_UNAVAILABLE" },
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  const jevSummary = {
    result: jev.result,
    confidence: jev.confidence,
    disposition: jev.disposition,
    reason_code: jev.reason_code,
    fallback: jev.fallback,
    provider_request_id: jev.provider_request_id
  };

  if (jev.result === "FALLBACK_DENY" || jev.fallback) {
    return {
      schema_version: 2,
      disposition: "FALLBACK",
      reason: jev.reason_code ?? "JEV_FALLBACK",
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: null,
      tool_arguments: null,
      eligible_tools: eligibleIds,
      jev: jevSummary,
      policy: { disposition: "DENY", reason: "JEV_FALLBACK" },
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  if (!REA_LOCAL_ALLOWLIST_IDS.has(jev.result)) {
    return {
      schema_version: 2,
      disposition: "DENY",
      reason: "JEV_TOOL_NOT_ALLOWLISTED",
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: null,
      tool_arguments: null,
      eligible_tools: eligibleIds,
      jev: jevSummary,
      policy: { disposition: "DENY", reason: "JEV_TOOL_NOT_ALLOWLISTED" },
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  const selected = getAllowlistedTool(jev.result);
  if (!selected || !eligibleIds.includes(selected.id)) {
    return {
      schema_version: 2,
      disposition: "DENY",
      reason: "JEV_TOOL_NOT_ELIGIBLE",
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: jev.result,
      tool_arguments: null,
      eligible_tools: eligibleIds,
      jev: jevSummary,
      policy: { disposition: "DENY", reason: "JEV_TOOL_NOT_ELIGIBLE" },
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  const argValidation = validateToolArguments(selected, request.tool_arguments, workspaceRoots);
  if (!argValidation.ok) {
    return {
      schema_version: 2,
      disposition: "DENY",
      reason: argValidation.reason,
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: selected.id,
      tool_arguments: null,
      eligible_tools: eligibleIds,
      jev: jevSummary,
      policy: { disposition: "DENY", reason: argValidation.reason },
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  const targets =
    selected.id === "analyze_javascript_application"
      ? [String(argValidation.args.input_path)]
      : [];

  const hardPolicy = evaluateHardPolicy({
    project: request.project,
    operation: "READ",
    targets,
    environment: "local"
  });

  if (hardPolicy.disposition === "DENY") {
    return {
      schema_version: 2,
      disposition: "DENY",
      reason: hardPolicy.reason,
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: selected.id,
      tool_arguments: argValidation.args,
      eligible_tools: eligibleIds,
      jev: jevSummary,
      policy: hardPolicy,
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  if (selected.effects.some((e) => e === "WRITE" || e === "NETWORK" || e === "PROCESS" || e === "DESTRUCTIVE")) {
    return {
      schema_version: 2,
      disposition: "HUMAN_REVIEW",
      reason: "REA_TOOL_SIDE_EFFECT_REVIEW",
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: selected.id,
      tool_arguments: argValidation.args,
      eligible_tools: eligibleIds,
      jev: jevSummary,
      policy: { disposition: "ASK", reason: "REA_TOOL_SIDE_EFFECT_REVIEW" },
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  const routeDisposition = mapJevToRouteDisposition(jev);
  if (routeDisposition !== "ALLOW_HANDOFF") {
    return {
      schema_version: 2,
      disposition: routeDisposition,
      reason: jev.reason_code ?? "JEV_REVIEW_REQUIRED",
      capability_id: "mcp.rea",
      capability_registry_status: "PLANNED",
      local_handoff_enabled: true,
      selected_tool: selected.id,
      tool_arguments: argValidation.args,
      eligible_tools: eligibleIds,
      jev: jevSummary,
      policy: hardPolicy,
      injection,
      handoff: null,
      receipt: baseReceipt
    };
  }

  return {
    schema_version: 2,
    disposition: "ALLOW_HANDOFF",
    reason: "POLICY_CHECKED_REA_HANDOFF",
    capability_id: "mcp.rea",
    capability_registry_status: "PLANNED",
    local_handoff_enabled: true,
    selected_tool: selected.id,
    tool_arguments: argValidation.args,
    eligible_tools: eligibleIds,
    jev: jevSummary,
    policy: hardPolicy,
    injection,
    handoff: {
      transport: "CURSOR_MCP",
      namespace: "user-rea",
      tool: selected.id,
      arguments: argValidation.args
    },
    receipt: baseReceipt
  };
}
