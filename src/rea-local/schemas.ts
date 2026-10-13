import { z } from "zod";

export const reaLocalRouteRequestSchema = z.object({
  project: z.string().min(1),
  task_id: z.string().min(1).optional(),
  task: z.string().min(1).max(4000),
  tool_hint: z.string().min(1).optional(),
  tool_arguments: z.record(z.string(), z.unknown()).default({}),
  rea_mcp_connected: z.boolean(),
  untrusted_evidence: z.string().max(200_000).optional()
});

export type ReaLocalRouteRequest = z.infer<typeof reaLocalRouteRequestSchema>;

export const reaRouteDispositionSchema = z.enum([
  "ALLOW_HANDOFF",
  "HUMAN_REVIEW",
  "DENY",
  "FALLBACK",
  "UNAVAILABLE"
]);

export type ReaRouteDisposition = z.infer<typeof reaRouteDispositionSchema>;
