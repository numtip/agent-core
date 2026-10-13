import { z } from "zod";

export type ReaEffectTag = "READ" | "WRITE" | "PROCESS" | "NETWORK" | "EXTERNAL" | "DESTRUCTIVE";

export type ReaAllowlistedTool = {
  id: string;
  summary: string;
  effects: ReaEffectTag[];
  argumentsSchema: z.ZodTypeAny;
  syntheticSampleOnly: boolean;
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

export const REA_LOCAL_ALLOWLIST: ReaAllowlistedTool[] = [
  {
    id: "binary_session",
    summary: "Read-only REA session metadata without opening a binary target.",
    effects: ["READ"],
    argumentsSchema: binarySessionArgsSchema,
    syntheticSampleOnly: false
  },
  {
    id: "analyze_javascript_application",
    summary: "Static JavaScript application analysis for the bounded synthetic inbox sample.",
    effects: ["READ"],
    argumentsSchema: analyzeJavascriptArgsSchema,
    syntheticSampleOnly: true
  }
];

export const REA_LOCAL_ALLOWLIST_IDS = new Set(REA_LOCAL_ALLOWLIST.map((t) => t.id));

export function getAllowlistedTool(id: string): ReaAllowlistedTool | undefined {
  return REA_LOCAL_ALLOWLIST.find((t) => t.id === id);
}
