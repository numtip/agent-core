import type { ReaAllowlistedTool } from "./allowlist.js";
import { canonicalPathWithinRoots, isUnderSyntheticSample } from "./path-guard.js";

function collectPathArgs(
  toolId: string,
  data: Record<string, unknown>
): { key: string; value: string }[] {
  const paths: { key: string; value: string }[] = [];
  const push = (key: string, value: unknown) => {
    if (typeof value === "string" && value.length > 0) paths.push({ key, value });
  };

  if (toolId === "analyze_javascript_application") {
    push("input_path", data.input_path);
    return paths;
  }

  if (toolId === "trace_web_module_imports") {
    push("manifest_path", data.manifest_path);
    const importMap = data.import_map;
    if (importMap && typeof importMap === "object" && !Array.isArray(importMap)) {
      push("import_map.path", (importMap as { path?: unknown }).path);
    }
    return paths;
  }

  if (toolId === "trace_web_source_location") {
    push("manifest_path", data.manifest_path);
    const sourceMap = data.source_map;
    if (sourceMap && typeof sourceMap === "object" && !Array.isArray(sourceMap)) {
      push("source_map.path", (sourceMap as { path?: unknown }).path);
    }
    return paths;
  }

  return paths;
}

export function validateToolArguments(
  tool: ReaAllowlistedTool,
  raw: Record<string, unknown>,
  workspaceRoots: string[]
): { ok: true; args: Record<string, unknown> } | { ok: false; reason: string } {
  const parsed = tool.argumentsSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "TOOL_ARGUMENTS_INVALID" };
  }

  const data = parsed.data as Record<string, unknown>;
  const pathBindings = collectPathArgs(tool.id, data);
  if (pathBindings.length === 0) {
    return { ok: true, args: data };
  }

  if (!workspaceRoots.length) {
    return { ok: false, reason: "PATH_OUTSIDE_WORKSPACE" };
  }

  const canonicalByKey = new Map<string, string>();
  for (const { key, value } of pathBindings) {
    const pathCheck = canonicalPathWithinRoots(value, workspaceRoots);
    if (!pathCheck.ok) return { ok: false, reason: pathCheck.reason };
    canonicalByKey.set(key, pathCheck.canonicalPath);
  }

  if (tool.pathPolicy === "synthetic") {
    const root = workspaceRoots[0];
    for (const canonical of canonicalByKey.values()) {
      if (!root || !isUnderSyntheticSample(canonical, root)) {
        return { ok: false, reason: "SYNTHETIC_SAMPLE_PATH_REQUIRED" };
      }
    }
  }

  const args = { ...data };
  for (const [key, canonical] of canonicalByKey) {
    if (key === "input_path") args.input_path = canonical;
    else if (key === "manifest_path") args.manifest_path = canonical;
    else if (key === "import_map.path" && args.import_map && typeof args.import_map === "object") {
      args.import_map = { ...(args.import_map as object), path: canonical };
    } else if (key === "source_map.path" && args.source_map && typeof args.source_map === "object") {
      args.source_map = { ...(args.source_map as object), path: canonical };
    }
  }

  return { ok: true, args };
}
