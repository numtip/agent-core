import { randomUUID } from "node:crypto";
import { z } from "zod";
import { governContext } from "./context-governor.js";
import { evaluateHardPolicy } from "./policy.js";

export const knowledgeEvidenceSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(200_000),
  path: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
  source_url: z.string().url().optional(),
  revision: z.string().min(1).optional(),
  kind: z.string().min(1).default("knowledge"),
  importance: z.number().min(0).max(1).default(0.5)
});

export const knowledgeQuerySchema = z.object({
  project: z.string().min(1),
  task_id: z.string().min(1).optional(),
  query: z.string().min(1).max(20_000),
  workspace: z.string().min(1).optional(),
  repositories: z.array(z.string().min(1)).max(50).default([]),
  limit: z.number().int().min(1).max(50).default(10),
  max_context_items: z.number().int().min(1).max(100).default(12),
  evidence: z.array(knowledgeEvidenceSchema).max(200).default([])
});

export type KnowledgeQuery = z.infer<typeof knowledgeQuerySchema>;

export function queryKnowledgeFabric(raw: unknown) {
  const request=knowledgeQuerySchema.parse(raw);
  const policy=evaluateHardPolicy({project:request.project,operation:"READ"});
  const receipt_id=`knw_${randomUUID()}`;

  if(policy.disposition!=="ALLOW"){
    return {
      schema_version:2,
      receipt_id,
      disposition:"DENIED" as const,
      authority:"CONTEXT_ONLY" as const,
      reason:policy.reason,
      policy
    };
  }

  if(request.evidence.length===0){
    return {
      schema_version:2,
      receipt_id,
      disposition:"HANDOFF" as const,
      authority:"CONTEXT_ONLY" as const,
      reason:"OPENWIKI_READ_HANDOFF",
      policy,
      handoff:{
        capability_id:"knowledge.openwiki",
        transport:"OPENWIKI_MCP",
        operation:"READ",
        workspace:request.workspace ?? request.project,
        query:request.query,
        repositories:request.repositories,
        limit:request.limit
      },
      guardrails:{
        read_only:true,
        knowledge_is_not_authority:true,
        verify_source_of_truth_before_execution:true
      }
    };
  }

  const context=governContext({
    project:request.project,
    task_id:request.task_id,
    query:request.query,
    max_items:request.max_context_items,
    items:request.evidence.map((item)=>({
      id:item.id,
      text:item.text,
      path:item.path,
      kind:item.kind,
      source:"openwiki",
      importance:item.importance
    }))
  });

  return {
    schema_version:2,
    receipt_id,
    disposition:"CONTEXT_READY" as const,
    authority:"CONTEXT_ONLY" as const,
    reason:"OPENWIKI_EVIDENCE_GOVERNED",
    policy,
    context,
    provenance:request.evidence.map((item)=>({
      id:item.id,
      repository:item.repository ?? null,
      path:item.path ?? null,
      source_url:item.source_url ?? null,
      revision:item.revision ?? null
    })),
    guardrails:{
      read_only:true,
      knowledge_is_not_authority:true,
      verify_source_of_truth_before_execution:true
    }
  };
}
