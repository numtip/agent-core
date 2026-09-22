import { z } from "zod";

export const subagentRequestSchema = z.object({
  project: z.string().min(1),
  task_id: z.string().optional(),
  goal: z.string().min(1),
  operation: z.enum(["READ","WRITE","DESTRUCTIVE","EXTERNAL"]).default("READ"),
  candidate_agents: z.array(z.string().min(1)).min(1).max(20),
  context_ids: z.array(z.string().min(1)).max(100).default([])
});

export function planSubagent(input: z.infer<typeof subagentRequestSchema>) {
  const preferred = input.candidate_agents.find((agent)=>input.goal.toLowerCase().includes(agent.toLowerCase())) ?? input.candidate_agents[0];
  return { delegate:true, agent:preferred, operation:input.operation, context_ids:input.context_ids, dedupe_key: input.project + ":" + input.goal.trim().toLowerCase() };
}