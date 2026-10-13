import { getActiveAllowlist, getActiveAllowlistIds } from "./allowlist-profiles.js";
import type { ReaAllowlistedTool } from "./allowlist.js";
import type { ReaAllowlistProfile } from "./types.js";
import type { ReaLocalRouteRequest } from "./schemas.js";

function argsIncludeKeys(args: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((k) => {
    if (k === "source_map") {
      return args.source_map !== undefined && typeof args.source_map === "object";
    }
    return typeof args[k] === "string" || typeof args[k] === "number" || args[k] !== undefined;
  });
}

function matchTaskKeywords(task: string, tool: ReaAllowlistedTool): boolean {
  if (!tool.taskKeywords?.length) return false;
  const lower = task.toLowerCase();
  return tool.taskKeywords.some((kw) => lower.includes(kw.toLowerCase()));
}

export function deterministicEligibleTools(
  request: ReaLocalRouteRequest,
  profile: ReaAllowlistProfile | undefined
): string[] {
  const activeIds = getActiveAllowlistIds(profile);
  const active = getActiveAllowlist(profile);

  const hint = request.tool_hint?.trim();
  if (hint) {
    return activeIds.has(hint) ? [hint] : [];
  }

  const args = request.tool_arguments ?? {};
  const eligible: string[] = [];

  for (const tool of active) {
    if (tool.requiresArgumentKeys?.length && argsIncludeKeys(args, tool.requiresArgumentKeys)) {
      eligible.push(tool.id);
    }
  }

  if (eligible.length) {
    return [...new Set(eligible)];
  }

  if (typeof args.input_path === "string" && args.input_path.length > 0 && activeIds.has("analyze_javascript_application")) {
    return ["analyze_javascript_application"];
  }

  if (typeof args.manifest_path === "string" && args.manifest_path.length > 0) {
    const manifestTools = active
      .filter((t) => t.requiresArgumentKeys?.includes("manifest_path"))
      .map((t) => t.id);
    if (manifestTools.length) return manifestTools;
  }

  const taskMatches = active.filter((t) => matchTaskKeywords(request.task, t)).map((t) => t.id);
  if (taskMatches.length) return [...new Set(taskMatches)];

  return [];
}
