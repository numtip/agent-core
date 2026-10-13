import { randomUUID } from "node:crypto";
import { z } from "zod";
import { governContext } from "./context-governor.js";
import { redactKnowledgeText, shouldBlockPrivateObservation } from "./knowledge-redaction.js";
import { evaluateHardPolicy } from "./policy.js";

export const knowledgeSourceSchema = z.enum(["openwiki", "observation", "memory_store"]);

export const knowledgeEvidenceSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(200_000),
  path: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
  source_url: z.string().url().optional(),
  revision: z.string().min(1).optional(),
  kind: z.string().min(1).default("knowledge"),
  source: knowledgeSourceSchema.optional(),
  observed_at: z.string().min(1).optional(),
  session_id: z.string().min(1).optional(),
  importance: z.number().min(0).max(1).default(0.5),
  filtered: z.boolean().default(false)
});

export const knowledgeQuerySchema = z.object({
  project: z.string().min(1),
  task_id: z.string().min(1).optional(),
  query: z.string().min(1).max(20_000),
  workspace: z.string().min(1).optional(),
  repositories: z.array(z.string().min(1)).max(50).default([]),
  memory_repositories: z.array(z.string().min(1)).max(20).default([]),
  sources: z.array(knowledgeSourceSchema).min(1).max(3).default(["openwiki"]),
  importance_min: z.number().min(0).max(1).default(0.6),
  include_unfiltered: z.boolean().default(false),
  limit: z.number().int().min(1).max(50).default(10),
  max_context_items: z.number().int().min(1).max(100).default(12),
  evidence: z.array(knowledgeEvidenceSchema).max(200).default([])
});

export type KnowledgeQuery = z.infer<typeof knowledgeQuerySchema>;
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

const guardrails = {
  read_only: true as const,
  knowledge_is_not_authority: true as const,
  verify_source_of_truth_before_execution: true as const
};

function evidenceSource(item: z.infer<typeof knowledgeEvidenceSchema>): string {
  if (item.source) return item.source;
  if (item.kind === "observation") return "observation";
  if (item.kind === "memory") return "memory_store";
  return "openwiki";
}

function buildHandoff(request: KnowledgeQuery, source: KnowledgeSource) {
  const repos = request.memory_repositories.length > 0
    ? request.memory_repositories
    : request.repositories;

  if (source === "observation") {
    return {
      capability_id: "knowledge.observation" as const,
      transport: "PROJECT_CLIENT" as const,
      operation: "READ" as const,
      workspace: request.workspace ?? request.project,
      query: request.query,
      repositories: repos,
      limit: request.limit,
      filter: {
        importance_min: request.importance_min,
        include_unfiltered: request.include_unfiltered,
        prefer_kinds: ["observation"]
      },
      client_steps: [
        "Pull filtered observation export from the configured GitHub memory repository",
        "Redact secrets locally before posting evidence",
        "Re-post to /v2/knowledge/query with the evidence array"
      ]
    };
  }

  if (source === "memory_store") {
    return {
      capability_id: "knowledge.memory-store" as const,
      transport: "PROJECT_CLIENT" as const,
      operation: "READ" as const,
      workspace: request.workspace ?? request.project,
      query: request.query,
      repositories: repos,
      limit: request.limit,
      paths: [".ai/memory/", ".ai/state/"],
      client_steps: [
        "Read project memory snapshots or Hermes export for this workspace",
        "Never treat memory as authorization; verify live repo state before writes",
        "Re-post governed evidence to /v2/knowledge/query"
      ]
    };
  }

  return {
    capability_id: "knowledge.openwiki" as const,
    transport: "OPENWIKI_MCP" as const,
    operation: "READ" as const,
    workspace: request.workspace ?? request.project,
    query: request.query,
    repositories: request.repositories,
    limit: request.limit
  };
}

function prepareEvidence(
  items: z.infer<typeof knowledgeEvidenceSchema>[],
  importanceMin: number,
  includeUnfiltered: boolean
) {
  const filtered = includeUnfiltered
    ? items
    : items.filter((item) => item.filtered || item.importance >= importanceMin);

  const accepted: Array<z.infer<typeof knowledgeEvidenceSchema> & { redaction_reasons: string[]; redacted: boolean }> = [];
  let blocked = 0;

  for (const item of filtered) {
    if (shouldBlockPrivateObservation(item.text)) {
      blocked += 1;
      continue;
    }
    const redaction = redactKnowledgeText(item.text);
    if (redaction.blocked) {
      blocked += 1;
      continue;
    }
    accepted.push({
      ...item,
      text: redaction.text,
      redaction_reasons: redaction.reasons,
      redacted: redaction.redacted
    });
  }

  return { accepted, blocked_count: blocked };
}

export function queryKnowledgeFabric(raw: unknown) {
  const request = knowledgeQuerySchema.parse(raw);
  const policy = evaluateHardPolicy({ project: request.project, operation: "READ" });
  const receipt_id = `knw_${randomUUID()}`;

  if (policy.disposition !== "ALLOW") {
    return {
      schema_version: 2,
      receipt_id,
      disposition: "DENIED" as const,
      authority: "CONTEXT_ONLY" as const,
      reason: policy.reason,
      policy
    };
  }

  if (request.evidence.length === 0) {
    const handoffs = request.sources.map((source) => buildHandoff(request, source));
    const primary = handoffs[0];
    const reason = primary.capability_id === "knowledge.openwiki"
      ? "OPENWIKI_READ_HANDOFF"
      : primary.capability_id === "knowledge.observation"
        ? "OBSERVATION_READ_HANDOFF"
        : "MEMORY_STORE_READ_HANDOFF";

    return {
      schema_version: 2,
      receipt_id,
      disposition: "HANDOFF" as const,
      authority: "CONTEXT_ONLY" as const,
      reason,
      policy,
      handoff: primary,
      handoffs,
      guardrails
    };
  }

  const { accepted, blocked_count } = prepareEvidence(
    request.evidence,
    request.importance_min,
    request.include_unfiltered
  );

  if (!accepted.length) {
    return {
      schema_version: 2,
      receipt_id,
      disposition: "FALLBACK" as const,
      authority: "CONTEXT_ONLY" as const,
      reason: "EVIDENCE_BLOCKED_OR_FILTERED",
      policy,
      blocked_count,
      guardrails
    };
  }

  const context = governContext({
    project: request.project,
    task_id: request.task_id,
    query: request.query,
    max_items: request.max_context_items,
    items: accepted.map((item) => ({
      id: item.id,
      text: item.text,
      path: item.path,
      kind: item.kind,
      source: evidenceSource(item),
      importance: item.importance
    }))
  });

  return {
    schema_version: 2,
    receipt_id,
    disposition: "CONTEXT_READY" as const,
    authority: "CONTEXT_ONLY" as const,
    reason: "KNOWLEDGE_EVIDENCE_GOVERNED",
    policy,
    context,
    blocked_count,
    provenance: accepted.map((item) => ({
      id: item.id,
      repository: item.repository ?? null,
      path: item.path ?? null,
      source_url: item.source_url ?? null,
      revision: item.revision ?? null,
      source: evidenceSource(item),
      observed_at: item.observed_at ?? null,
      session_id: item.session_id ?? null,
      filtered: item.filtered,
      redacted: item.redacted,
      redaction_reasons: item.redaction_reasons
    })),
    guardrails
  };
}
