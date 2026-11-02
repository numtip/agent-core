import { z } from "zod";

export const capabilityKindSchema = z.enum([
  "DETERMINISTIC",
  "MODEL",
  "AGENT",
  "TOOL",
  "SKILL",
  "MCP",
  "WORKFLOW"
]);

export const capabilityStatusSchema = z.enum(["ACTIVE", "PLANNED", "DISABLED"]);
export const capabilityRiskSchema = z.enum(["LOW", "MEDIUM", "HIGH"]);
export const operationSchema = z.enum(["READ", "WRITE", "DESTRUCTIVE", "EXTERNAL"]);

export const capabilitySchema = z.object({
  id: z.string().min(1),
  kind: capabilityKindSchema,
  description: z.string().min(1),
  tags: z.array(z.string().min(1)).default([]),
  operations: z.array(operationSchema).min(1),
  projects: z.array(z.string().min(1)).default(["*"]),
  risk: capabilityRiskSchema.default("LOW"),
  status: capabilityStatusSchema.default("ACTIVE"),
  priority: z.number().int().min(0).max(100).default(50),
  metadata: z.record(z.string(), z.unknown()).default({})
}).superRefine((capability, ctx) => {
  // A SKILL is documentation loaded into an agent runtime: it can inform a decision, it cannot perform the
  // write. Nothing in the router branches on `kind`, so a declared WRITE would be routable for every project
  // in `projects`. Enforced in the schema so register(), upsert() and the default registry all obey it.
  if (capability.kind !== "SKILL") return;
  for (const forbidden of ["WRITE", "DESTRUCTIVE"] as const) {
    if (capability.operations.includes(forbidden)) {
      ctx.addIssue({
        code: "custom",
        message: `SKILL_OPERATION_FORBIDDEN:${capability.id}:${forbidden}`,
        path: ["operations"]
      });
    }
  }
});

export type Capability = z.infer<typeof capabilitySchema>;
// What a caller may hand in: defaults (tags/projects/risk/status/priority/metadata) are optional.
export type CapabilityInput = z.input<typeof capabilitySchema>;
export type CapabilityKind = z.infer<typeof capabilityKindSchema>;
export type Operation = z.infer<typeof operationSchema>;

export type CapabilityFilter = {
  project: string;
  operation: Operation;
  kinds?: CapabilityKind[];
  requiredTags?: string[];
  includePlanned?: boolean;
};

const defaultCapabilities: Capability[] = [
  {
    id: "deterministic.runtime",
    kind: "DETERMINISTIC",
    description: "Deterministic runtime for file transforms, validation, build, tests and other rule-based execution.",
    tags: ["deterministic", "runtime", "validation", "build", "test"],
    operations: ["READ", "WRITE"],
    projects: ["*"],
    risk: "LOW",
    status: "ACTIVE",
    priority: 95,
    metadata: { executor: "agent-core" }
  },
  {
    id: "model.frontier",
    kind: "MODEL",
    description: "Frontier reasoning model for complex analysis, coding, planning and review.",
    tags: ["reasoning", "coding", "analysis", "planning", "review"],
    operations: ["READ", "WRITE"],
    projects: ["*"],
    risk: "MEDIUM",
    status: "ACTIVE",
    priority: 80,
    metadata: { provider_routed: true }
  },
  {
    id: "model.groq",
    kind: "MODEL",
    description: "Task-routed chat inference: Groq (fast) and DeepSeek (reasoning) with a shared cost guard, circuit breakers and a policy-gated OpenRouter frontier tier.",
    tags: ["groq", "deepseek", "inference", "chat", "cost-guard", "routing"],
    operations: ["READ"],
    projects: ["agent-core"],
    risk: "MEDIUM",
    status: "PLANNED",
    priority: 72,
    metadata: {
      route: "/v2/inference/complete",
      scope: "inference",
      default_model: "openai/gpt-oss-120b",
      task_route: "fast→groq|deepseek, reasoning→deepseek|groq, frontier→openrouter|deepseek|groq",
      fallback: "policy-gated openrouter frontier tier",
      circuit_breaker: "per-provider, in-process",
      monthly_budget_usd: 10,
      pilot: true,
      vps_activation: "BLOCKED",
      multi_instance_budget: "NOT_GUARANTEED"
    }
  },
  {
    id: "agent.cursor",
    kind: "AGENT",
    description: "Cursor coding agent for repository-local implementation and refactoring workflows.",
    tags: ["coding", "repo", "refactor", "test"],
    operations: ["READ", "WRITE"],
    projects: ["*"],
    risk: "MEDIUM",
    status: "ACTIVE",
    priority: 75,
    metadata: { integration: "project-side" }
  },
  {
    id: "agent.codex",
    kind: "AGENT",
    description: "Codex coding agent for implementation, debugging and repository automation.",
    tags: ["coding", "repo", "debug", "automation"],
    operations: ["READ", "WRITE"],
    projects: ["*"],
    risk: "MEDIUM",
    status: "ACTIVE",
    priority: 75,
    metadata: { integration: "project-side" }
  },
  {
    id: "agent.hermes",
    kind: "AGENT",
    description: "Hermes execution agent intended for VPS-side operational workflows.",
    tags: ["vps", "operations", "deploy", "shell"],
    operations: ["READ", "WRITE", "EXTERNAL"],
    projects: ["*"],
    risk: "HIGH",
    status: "ACTIVE",
    priority: 70,
    metadata: { integration: "vps-side", production_requires_approval: true }
  },
  {
    id: "tool.git",
    kind: "TOOL",
    description: "Git operations for repository inspection, diffing, commits and branch workflows.",
    tags: ["git", "repo", "version-control"],
    operations: ["READ", "WRITE"],
    projects: ["*"],
    risk: "MEDIUM",
    status: "ACTIVE",
    priority: 85,
    metadata: {}
  },
  {
    id: "mcp.playwright",
    kind: "MCP",
    description: "Policy-controlled Playwright MCP handoff for browser inspection, navigation, input and approved web actions.",
    tags: ["browser", "playwright", "web", "qa"],
    operations: ["READ", "WRITE", "EXTERNAL", "DESTRUCTIVE"],
    projects: ["*"],
    risk: "HIGH",
    status: "ACTIVE",
    priority: 65,
    metadata: {
      phase: "V2-4",
      execution_mode: "HANDOFF",
      control_plane: "browser-control",
      requires_explicit_browser_scope: true,
      live_transport_requires_runtime_adapter: true
    }
  },
  {
    id: "knowledge.openwiki",
    kind: "MCP",
    description: "Read-only OpenWiki knowledge retrieval for evidence-backed repository context.",
    tags: ["knowledge", "openwiki", "wiki", "context", "retrieval", "evidence"],
    operations: ["READ"],
    projects: ["*"],
    risk: "LOW",
    status: "ACTIVE",
    priority: 88,
    metadata: {
      phase: "V2-9",
      execution_mode: "HANDOFF",
      transport: "OPENWIKI_MCP",
      authority: "CONTEXT_ONLY",
      read_only: true,
      context_governor_required: true,
      source_verification_required_before_execution: true
    }
  },
  {
    id: "knowledge.observation",
    kind: "WORKFLOW",
    description: "Read-only observation retrieval from filtered Claude-Mem or similar exports stored in a GitHub repository.",
    tags: ["knowledge", "observation", "memory", "claude-mem", "context", "github"],
    operations: ["READ"],
    projects: ["*"],
    risk: "LOW",
    status: "ACTIVE",
    priority: 82,
    metadata: {
      phase: "V2-9",
      execution_mode: "HANDOFF",
      transport: "PROJECT_CLIENT",
      authority: "CONTEXT_ONLY",
      read_only: true,
      context_governor_required: true,
      source_verification_required_before_execution: true,
      client_fetch: "github_observation_export"
    }
  },
  {
    id: "knowledge.memory-store",
    kind: "WORKFLOW",
    description: "Read-only project memory store (Hermes export, .ai/memory snapshots, or private GitHub memory repo).",
    tags: ["knowledge", "memory", "hermes", "sync", "context", "github"],
    operations: ["READ"],
    projects: ["*"],
    risk: "LOW",
    status: "ACTIVE",
    priority: 81,
    metadata: {
      phase: "V2-9",
      execution_mode: "HANDOFF",
      transport: "PROJECT_CLIENT",
      authority: "CONTEXT_ONLY",
      read_only: true,
      context_governor_required: true,
      source_verification_required_before_execution: true,
      client_fetch: "project_memory_paths"
    }
  },
  {
    id: "mcp.rea",
    kind: "MCP",
    description: "REA (Reverse Engineer Anything) MCP for bounded reverse-engineering via local Cursor handoff only.",
    tags: ["reverse-engineering", "rea", "decompile", "security-research", "mcp"],
    operations: ["READ", "EXTERNAL"],
    projects: ["*"],
    risk: "HIGH",
    status: "PLANNED",
    priority: 55,
    metadata: {
      phase: "PHASE-C",
      execution_mode: "HANDOFF",
      transport: "MCP",
      sandbox_root: "F:/projectAi/REA",
      setup_hint: "Human gate: complete docs/rea/LOCAL_PREFLIGHT.md before npx rea-agents setup",
      integration: "project-side-cursor-mcp",
      control_plane_execution: false,
      vps_execution: false
    }
  },
  {
    id: "mcp.obsidian-memory",
    kind: "MCP",
    description: "Read-only MCP bridge that exposes the Obsidian vault to ChatGPT deep research and company knowledge as the two tools they require: search and fetch. Retrieval is a bounded vault scan; redaction, hard policy and context ranking are served by this same Agent Core via /v2/knowledge/query.",
    tags: ["knowledge", "obsidian", "vault", "mcp", "chatgpt", "search", "fetch", "readonly", "context"],
    operations: ["READ"],
    projects: ["*"],
    risk: "LOW",
    status: "PLANNED",
    priority: 74,
    metadata: {
      phase: "MEMORY-BRIDGE-V1",
      execution_mode: "HANDOFF",
      transport: "STREAMABLE_HTTP",
      authority: "CONTEXT_ONLY",
      read_only: true,
      entrypoint: "src/memory-bridge-cli.ts",
      endpoint: "http://127.0.0.1:8792/mcp",
      tools: ["search", "fetch"],
      governance_upstream: "/v2/knowledge/query",
      requires: ["MEMORY_BRIDGE_PROJECT", "MEMORY_BRIDGE_PROJECT_TOKEN", "OBSIDIAN_VAULT_PATH"],
      // No write path exists in the adapter; vault access is read-only by construction.
      vault_write: "deny",
      public_exposure: "not exposed: requires owner-approved Cloudflare route + OAuth or bearer gate",
      enable_condition: "flip status to ACTIVE only after the bridge is deployed AND a real ChatGPT connection is verified",
      docs: "docs/integrations/CHATGPT_MEMORY_BRIDGE.md"
    }
  },
  {
    id: "skill.obsidian-markdown",
    kind: "SKILL",
    description: "Obsidian Flavored Markdown authoring guidance: wikilinks, embeds, callouts, properties, tags, math, Mermaid and footnotes. Documentation-only skill (no executable payload) installed into the Hermes runtime.",
    tags: ["skill", "obsidian", "markdown", "notes", "knowledge", "documentation", "vault"],
    // READ only, deliberately: nothing in the router branches on kind, so declaring WRITE would make this
    // entry routable for write requests of every project — and a context-only note style guide should never
    // be the capability that authorises a write. Actual file writes stay with tool.git / the runtime file tools.
    operations: ["READ"],
    projects: ["*"],
    risk: "LOW",
    status: "ACTIVE",
    priority: 70,
    metadata: {
      phase: "SKILLS-ADOPTION-V1",
      runtime: "hermes",
      skill_path: "note-taking/obsidian-markdown/SKILL.md",
      install_method: "hermes skills install (skills.sh)",
      upstream_repo: "https://github.com/kepano/obsidian-skills",
      upstream_commit: "3ccff5338ea700537839b21900aa5358a0402c98",
      license: "MIT",
      references: ["references/CALLOUTS.md", "references/EMBEDS.md", "references/PROPERTIES.md"],
      payload: "markdown-only",
      // Declarative only — metadata is a free-form z.record with no reader in src/. These keys record intent
      // for humans and for future gating; they are NOT enforced by code today.
      declared_write_scope: "markdown-files",
      vault_write_requires_explicit_request: true,
      authority: "CONTEXT_ONLY",
      validation_evidence: "docs/evidence/skills-adoption-2026-11-02.md"
    }
  },
  {
    id: "skill.defuddle",
    kind: "SKILL",
    description: "Extract clean readable Markdown from HTML pages via the Defuddle CLI (version pinned), removing navigation and clutter before content enters context.",
    tags: ["skill", "defuddle", "web", "extraction", "markdown", "context", "tokens"],
    operations: ["READ", "EXTERNAL"],
    projects: ["*"],
    risk: "LOW",
    status: "ACTIVE",
    priority: 65,
    metadata: {
      phase: "SKILLS-ADOPTION-V1",
      runtime: "hermes",
      skill_path: "note-taking/defuddle/SKILL.md",
      install_method: "hermes skills install (skills.sh)",
      upstream_repo: "https://github.com/kepano/obsidian-skills",
      upstream_commit: "3ccff5338ea700537839b21900aa5358a0402c98",
      license: "MIT",
      payload: "markdown-only",
      required_cli: "defuddle",
      cli_version_pinned: "0.19.6",
      cli_install: "npm install -g defuddle@0.19.6",
      // Local delta from upstream: upstream SKILL.md documents an unpinned global npm install,
      // which the skills-guard scanner flags as MEDIUM supply_chain. The vendored copy pins the version.
      upstream_delta: "SKILL.md install line pinned to 0.19.6",
      network_egress: "target-url-only, no credentials",
      authority: "CONTEXT_ONLY",
      validation_evidence: "docs/evidence/skills-adoption-2026-11-02.md"
    }
  }
];

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, Capability>();

  constructor(initial: Capability[] = defaultCapabilities) {
    for (const capability of initial) this.register(capability);
  }

  register(input: CapabilityInput): Capability {
    const capability = capabilitySchema.parse(input);
    if (this.capabilities.has(capability.id)) throw new Error(`CAPABILITY_EXISTS:${capability.id}`);
    this.capabilities.set(capability.id, capability);
    return capability;
  }

  upsert(input: CapabilityInput): Capability {
    const capability = capabilitySchema.parse(input);
    this.capabilities.set(capability.id, capability);
    return capability;
  }

  get(id: string): Capability | undefined {
    return this.capabilities.get(id);
  }

  list(): Capability[] {
    return [...this.capabilities.values()].sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  }

  candidates(filter: CapabilityFilter): Capability[] {
    const requiredTags = new Set(filter.requiredTags ?? []);
    const allowedKinds = filter.kinds ? new Set(filter.kinds) : null;
    return this.list().filter((capability) => {
      if (capability.status === "DISABLED") return false;
      if (capability.status === "PLANNED" && !filter.includePlanned) return false;
      if (!capability.operations.includes(filter.operation)) return false;
      if (!capability.projects.includes("*") && !capability.projects.includes(filter.project)) return false;
      if (allowedKinds && !allowedKinds.has(capability.kind)) return false;
      if ([...requiredTags].some((tag) => !capability.tags.includes(tag))) return false;
      return true;
    });
  }
}

export function createDefaultCapabilityRegistry() {
  return new CapabilityRegistry();
}
