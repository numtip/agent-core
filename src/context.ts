import { z } from "zod";

export const contextRequestSchema = z.object({
  project: z.string().min(1),
  query: z.string().min(1),
  candidates: z.array(z.object({
    id: z.string().min(1),
    path: z.string().optional(),
    text: z.string().min(1),
    kind: z.string().optional()
  })).min(1).max(200),
  limit: z.number().int().min(1).max(50).default(20)
});

export type ContextRequest = z.infer<typeof contextRequestSchema>;

function tokenize(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^\p{L}\p{N}_-]+/u).filter((t)=>t.length>=2));
}

export function selectContext(input: ContextRequest) {
  const queryTokens = tokenize(input.query);
  const ranked = input.candidates.map((candidate)=>{
    const candidateTokens = tokenize([candidate.path ?? "", candidate.kind ?? "", candidate.text].join(" "));
    let overlap = 0;
    for (const token of queryTokens) if (candidateTokens.has(token)) overlap += 1;
    const pathBonus = candidate.path && [...queryTokens].some((token)=>candidate.path!.toLowerCase().includes(token)) ? 2 : 0;
    return { ...candidate, score: overlap + pathBonus };
  }).sort((a,b)=>b.score-a.score).slice(0,input.limit);
  return { query: input.query, selected: ranked, strategy: "deterministic-lexical-v1" };
}