import { z } from "zod";
import type { ReaAllowlistProfile, ReaPathPolicy, ReaRiskClass } from "./types.js";

export type ReaEffectTag = "READ" | "WRITE" | "PROCESS" | "NETWORK" | "EXTERNAL" | "DESTRUCTIVE";

export type ReaAllowlistedTool = {
  id: string;
  summary: string;
  effects: ReaEffectTag[];
  riskClass: ReaRiskClass;
  pathPolicy: ReaPathPolicy;
  minimumProfile: ReaAllowlistProfile;
  argumentsSchema: z.ZodTypeAny;
  /** @deprecated use pathPolicy === "synthetic" */
  syntheticSampleOnly: boolean;
  taskKeywords?: string[];
  requiresArgumentKeys?: string[];
};

const binarySessionArgsSchema = z
  .object({
    expected_package_version: z.string().min(1).optional(),
    expected_catalog_digest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    expected_server_path: z.string().min(1).optional()
  })
  .strict();

const analyzeJavascriptArgsSchema = z
  .object({
    input_path: z.string().min(1),
    format: z.enum(["auto", "asar", "directory"]).optional(),
    detail: z.enum(["complete", "summary"]).optional(),
    integrity_policy: z.enum(["fail", "record-and-continue"]).optional(),
    max_heap_mb: z.number().int().min(128).max(16384).optional(),
    analysis_timeout_ms: z.number().int().min(1).optional()
  })
  .strict();

const traceWebModuleImportsSchema = z
  .object({
    manifest_path: z.string().min(1),
    script_index: z.number().int().min(0),
    importer_url: z.string().min(1).optional(),
    import_map: z
      .object({
        path: z.string().min(1),
        base_url: z.string().min(1)
      })
      .strict()
      .optional()
  })
  .strict();

const traceWebSourceLocationSchema = z
  .object({
    manifest_path: z.string().min(1),
    script_index: z.number().int().min(0),
    source_map: z
      .object({
        path: z.string().min(1),
        url: z.string().min(1)
      })
      .strict(),
    generated_position: z
      .object({
        line: z.number().int().min(1),
        column: z.number().int().min(0)
      })
      .strict()
  })
  .strict();

export const REA_LOCAL_ALLOWLIST: ReaAllowlistedTool[] = [
  {
    id: "binary_session",
    summary: "Read-only REA session metadata without opening a binary target.",
    effects: ["READ"],
    riskClass: "READ",
    pathPolicy: "none",
    minimumProfile: "v1",
    argumentsSchema: binarySessionArgsSchema,
    syntheticSampleOnly: false,
    taskKeywords: ["session", "metadata", "binary_session"]
  },
  {
    id: "analyze_javascript_application",
    summary: "Static JavaScript application analysis for the bounded synthetic inbox sample.",
    effects: ["READ"],
    riskClass: "STATIC_ANALYSIS",
    pathPolicy: "synthetic",
    minimumProfile: "v1",
    argumentsSchema: analyzeJavascriptArgsSchema,
    syntheticSampleOnly: true,
    requiresArgumentKeys: ["input_path"],
    taskKeywords: ["javascript", "synthetic", "analyze"]
  },
  {
    id: "trace_web_module_imports",
    summary:
      "Trace ES module imports from a local export_web_scripts manifest (workspace-bounded paths only).",
    effects: ["READ", "PROCESS"],
    riskClass: "STATIC_ANALYSIS",
    pathPolicy: "workspace",
    minimumProfile: "v2",
    argumentsSchema: traceWebModuleImportsSchema,
    syntheticSampleOnly: false,
    requiresArgumentKeys: ["manifest_path"],
    taskKeywords: ["module import", "export_web_scripts", "manifest"]
  },
  {
    id: "trace_web_source_location",
    summary:
      "Map a generated script position through a local source map paired with an export manifest (workspace-bounded).",
    effects: ["READ", "PROCESS"],
    riskClass: "STATIC_ANALYSIS",
    pathPolicy: "workspace",
    minimumProfile: "v2",
    argumentsSchema: traceWebSourceLocationSchema,
    syntheticSampleOnly: false,
    requiresArgumentKeys: ["manifest_path", "source_map"],
    taskKeywords: ["source map", "source_map", "generated position"]
  }
];

export const REA_LOCAL_ALLOWLIST_IDS = new Set(REA_LOCAL_ALLOWLIST.map((t) => t.id));

export function getAllowlistedTool(id: string): ReaAllowlistedTool | undefined {
  return REA_LOCAL_ALLOWLIST.find((t) => t.id === id);
}
