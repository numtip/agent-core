import { z } from "zod";

export const decisionTypeSchema = z.enum([
  "TASK_ROUTE",
  "CONTEXT_ROUTE",
  "TOOL_ROUTE",
  "MODEL_ROUTE",
  "SUBAGENT_ROUTE",
  "NEXT_ACTION",
  "QA_DISPOSITION",
  "HUMAN_ESCALATION"
]);

const choiceQuestionSchema = z.object({
  type: z.literal("choice"),
  instructions: z.string().min(1),
  criteria: z.record(z.string(), z.string().min(1)).refine(
    (value) => Object.keys(value).length >= 2,
    "choice criteria must contain at least two options"
  )
});

const noulQuestionSchema = z.object({
  type: z.literal("noul"),
  instructions: z.string().min(1),
  true_when: z.string().min(1),
  false_when: z.string().min(1)
});

const scoreQuestionSchema = z.object({
  type: z.literal("score"),
  instructions: z.string().min(1),
  levels: z.array(z.string().min(1)).min(2).max(6)
});

export const questionSchema = z.discriminatedUnion("type", [
  choiceQuestionSchema,
  noulQuestionSchema,
  scoreQuestionSchema
]);

export const decisionRequestSchema = z.object({
  project: z.string().min(1),
  task_id: z.string().min(1).optional(),
  decision_type: decisionTypeSchema,
  state: z.record(z.string(), z.unknown()),
  question: questionSchema,
  fallback_result: z.string().min(1).optional()
});

export type DecisionRequest = z.infer<typeof decisionRequestSchema>;

export const decisionResponseSchema = z.object({
  decision_type: decisionTypeSchema,
  result: z.string(),
  confidence: z.number().min(0).max(1),
  reason_code: z.string().nullable(),
  fallback: z.boolean(),
  disposition: z.enum(["EXECUTE", "REVIEW", "FALLBACK"]),
  provider_request_id: z.string().nullable()
});

export type DecisionResponse = z.infer<typeof decisionResponseSchema>;
