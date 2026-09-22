import { z } from "zod";

export const advancedRouteSchema = z.object({
  project:z.string().min(1),
  task:z.string().min(1),
  sensitivity:z.enum(["public","standard","restricted"]),
  complexity:z.enum(["deterministic","simple","complex"]),
  cost_preference:z.enum(["lowest","balanced","quality"]).default("balanced"),
  operation:z.enum(["READ","WRITE","DESTRUCTIVE","EXTERNAL"]).default("READ")
});

export function advancedRoute(input:z.infer<typeof advancedRouteSchema>) {
  if(input.complexity==="deterministic") return {tier:"DETERMINISTIC",reason:"NO_MODEL_REQUIRED"};
  if(input.sensitivity==="restricted") return {tier:"FRONTIER_RESTRICTED",reason:"RESTRICTED_DATA"};
  if(input.operation==="DESTRUCTIVE") return {tier:"HUMAN_REVIEW",reason:"DESTRUCTIVE_OPERATION"};
  if(input.complexity==="complex") return {tier:"FRONTIER",reason:"COMPLEX_REASONING"};
  if(input.cost_preference==="lowest" && input.sensitivity==="public") return {tier:"CHEAP",reason:"PUBLIC_LOW_COST"};
  return {tier:"STANDARD",reason:"BALANCED_DEFAULT"};
}