import { z } from "zod";

export const inferenceMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string().min(1).max(32_000)
});

export const inferenceCompleteRequestSchema = z.object({
  project: z.string().min(1),
  task_id: z.string().min(1).optional(),
  messages: z.array(inferenceMessageSchema).min(1).max(32),
  max_tokens: z.number().int().min(16).max(4096).optional(),
  temperature: z.number().min(0).max(2).optional(),
  provider_preference: z.enum(["auto", "groq", "openrouter"]).optional()
});

export type InferenceCompleteRequest = z.infer<typeof inferenceCompleteRequestSchema>;

export const inferenceCompleteResponseSchema = z.object({
  content: z.string(),
  provider: z.enum(["groq", "openrouter"]),
  model: z.string(),
  fallback: z.boolean(),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative(),
    completion_tokens: z.number().int().nonnegative(),
    total_tokens: z.number().int().nonnegative()
  }),
  estimated_cost_usd: z.number().nonnegative(),
  cost_basis: z.literal("estimate_from_provider_usage"),
  pricing_provider: z.enum(["groq", "openrouter"]),
  budget: z.object({
    month: z.string(),
    spent_usd: z.number().nonnegative(),
    remaining_usd: z.number().nonnegative(),
    budget_usd: z.number().nonnegative(),
    overspend_blocked: z.boolean()
  }),
  provider_request_id: z.string().nullable(),
  attempts: z.number().int().positive(),
  ledger_before_usd: z.number().nonnegative()
});

export type InferenceCompleteResponse = z.infer<typeof inferenceCompleteResponseSchema>;
