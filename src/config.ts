export type RuntimeConfig = {
  env: string; host: string; port: number;
  openRouterApiKey?: string; openRouterDecisionsUrl: string; jevModel: string;
  requestTimeoutMs: number; confidenceExecute: number; confidenceReview: number;
  authRequired: boolean; projectKeys: Record<string,string>; projectScopes: Record<string,string[]>;
  rateLimitMax: number; rateLimitWindowMs: number; auditLogPath: string | null;
  playwrightMcpExecutionEnabled: boolean; playwrightMcpEndpoint: string; playwrightMcpTimeoutMs: number;
  reaLocalHandoffEnabled?: boolean;
  reaWorkspaceRoots?: string[];
  reaPackageVersion?: string;
  reaAllowlistProfile?: "v1" | "v2";
  groqEnabled?: boolean;
  groqApiKey?: string;
  groqBaseUrl?: string;
  groqModel?: string;
  groqTimeoutMs?: number;
  groqMaxRetries?: number;
  groqMonthlyBudgetUsd?: number;
  groqCostLedgerPath?: string | null;
  groqUsdPer1MInputTokens?: number;
  groqUsdPer1MOutputTokens?: number;
  groqFallbackOpenRouter?: boolean;
  openRouterChatUrl?: string;
  openRouterChatModel?: string;
  openRouterUsdPer1MInputTokens?: number;
  openRouterUsdPer1MOutputTokens?: number;
  groqLedgerLockTimeoutMs?: number;
  groqLedgerStaleLockMs?: number;
  groqMaxCompletionTokens?: number;
  // Origin auth for /control and /v1/control-metrics. With authRequired these are always
  // protected: "disabled" is honoured only when authRequired=false.
  controlAuthMode?: "cf-access" | "project" | "disabled";
  cfAccessTeamDomain?: string;
  cfAccessAudiences?: string[];
};

export function groqRuntimeDefaults(config: RuntimeConfig): Required<
  Pick<
    RuntimeConfig,
    | "groqEnabled"
    | "groqBaseUrl"
    | "groqModel"
    | "groqTimeoutMs"
    | "groqMaxRetries"
    | "groqMonthlyBudgetUsd"
    | "groqCostLedgerPath"
    | "groqUsdPer1MInputTokens"
    | "groqUsdPer1MOutputTokens"
    | "groqFallbackOpenRouter"
    | "openRouterChatUrl"
    | "openRouterChatModel"
  >
> {
  const env = config.env ?? "development";
  return {
    groqEnabled: config.groqEnabled ?? Boolean(config.groqApiKey),
    groqBaseUrl: config.groqBaseUrl ?? "https://api.groq.com/openai/v1",
    groqModel: config.groqModel ?? "openai/gpt-oss-120b",
    groqTimeoutMs: config.groqTimeoutMs ?? 15000,
    groqMaxRetries: config.groqMaxRetries ?? 2,
    groqMonthlyBudgetUsd: config.groqMonthlyBudgetUsd ?? 10,
    groqCostLedgerPath:
      config.groqCostLedgerPath !== undefined
        ? config.groqCostLedgerPath
        : env === "test"
          ? null
          : "./logs/groq-cost-ledger.json",
    groqUsdPer1MInputTokens: config.groqUsdPer1MInputTokens ?? 0.15,
    groqUsdPer1MOutputTokens: config.groqUsdPer1MOutputTokens ?? 0.6,
    groqFallbackOpenRouter: config.groqFallbackOpenRouter ?? true,
    openRouterChatUrl:
      config.openRouterChatUrl ?? "https://openrouter.ai/api/v1/chat/completions",
    openRouterChatModel: config.openRouterChatModel ?? "openai/gpt-oss-120b"
  };
}

function numberFromEnv(name:string,fallback:number){ const raw=process.env[name]; if(!raw)return fallback; const v=Number(raw); if(!Number.isFinite(v))throw new Error(name+" must be a number"); return v; }
function boolFromEnv(name:string,fallback:boolean){ const raw=process.env[name]; if(raw==null)return fallback; return ["1","true","yes","on"].includes(raw.toLowerCase()); }
// Never let the raw value reach the error/stack: these variables carry project tokens.
function jsonObject<T>(name:string,fallback:T):T { const raw=process.env[name]; if(!raw)return fallback; try { return JSON.parse(raw) as T; } catch { throw new Error(name+" must be valid JSON (value withheld)"); } }

function controlAuthModeFromEnv(): RuntimeConfig["controlAuthMode"] {
  const raw=process.env.AGENT_CORE_CONTROL_AUTH;
  if(raw==null || raw==="")return undefined;
  if(raw==="cf-access" || raw==="project" || raw==="disabled")return raw;
  throw new Error("AGENT_CORE_CONTROL_AUTH must be cf-access, project or disabled");
}

export function loadConfig(): RuntimeConfig {
  const env=process.env.AGENT_CORE_ENV ?? "development";
  return {
    env,
    host:process.env.AGENT_CORE_HOST ?? "127.0.0.1",
    port:numberFromEnv("AGENT_CORE_PORT",8787),
    openRouterApiKey:process.env.OPENROUTER_API_KEY,
    openRouterDecisionsUrl:process.env.OPENROUTER_DECISIONS_URL ?? "https://openrouter.ai/api/alpha/decisions",
    jevModel:"~typesafe/jev-latest",
    requestTimeoutMs:numberFromEnv("OPENROUTER_TIMEOUT_MS",8000),
    confidenceExecute:numberFromEnv("CONFIDENCE_EXECUTE",0.85),
    confidenceReview:numberFromEnv("CONFIDENCE_REVIEW",0.60),
    authRequired:boolFromEnv("AGENT_CORE_AUTH_REQUIRED",env==="production"),
    projectKeys:jsonObject<Record<string,string>>("AGENT_CORE_PROJECT_KEYS",{}),
    projectScopes:jsonObject<Record<string,string[]>>("AGENT_CORE_PROJECT_SCOPES",{}),
    rateLimitMax:numberFromEnv("AGENT_CORE_RATE_LIMIT_MAX",100),
    rateLimitWindowMs:numberFromEnv("AGENT_CORE_RATE_LIMIT_WINDOW_MS",60000),
    auditLogPath:process.env.AGENT_CORE_AUDIT_LOG ?? (env==="test" ? null : "./logs/audit.jsonl"),
    // Browser execution kill switch: live MCP execution stays off unless explicitly enabled.
    playwrightMcpExecutionEnabled:boolFromEnv("PLAYWRIGHT_MCP_EXECUTION_ENABLED",false),
    playwrightMcpEndpoint:process.env.PLAYWRIGHT_MCP_ENDPOINT ?? "http://127.0.0.1:8791/mcp",
    playwrightMcpTimeoutMs:numberFromEnv("PLAYWRIGHT_MCP_TIMEOUT_MS",20000),
    reaLocalHandoffEnabled:boolFromEnv("REA_LOCAL_HANDOFF_ENABLED",false),
    reaWorkspaceRoots:jsonObject<string[]>("REA_WORKSPACE_ROOTS",[]),
    reaPackageVersion:process.env.REA_PACKAGE_VERSION ?? "6.4.0",
    reaAllowlistProfile:(process.env.REA_ALLOWLIST_PROFILE === "v2" ? "v2" : "v1"),
    groqEnabled:boolFromEnv("GROQ_ENABLED",Boolean(process.env.GROQ_API_KEY)),
    groqApiKey:process.env.GROQ_API_KEY,
    groqBaseUrl:process.env.GROQ_BASE_URL ?? "https://api.groq.com/openai/v1",
    groqModel:process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
    groqTimeoutMs:numberFromEnv("GROQ_TIMEOUT_MS",15000),
    groqMaxRetries:numberFromEnv("GROQ_MAX_RETRIES",2),
    groqMonthlyBudgetUsd:numberFromEnv("GROQ_MONTHLY_BUDGET_USD",10),
    groqCostLedgerPath:process.env.GROQ_COST_LEDGER ?? (env==="test" ? null : "./logs/groq-cost-ledger.json"),
    groqUsdPer1MInputTokens:numberFromEnv("GROQ_USD_PER_1M_INPUT_TOKENS",0.15),
    groqUsdPer1MOutputTokens:numberFromEnv("GROQ_USD_PER_1M_OUTPUT_TOKENS",0.60),
    groqFallbackOpenRouter:boolFromEnv("GROQ_FALLBACK_OPENROUTER",true),
    openRouterChatUrl:process.env.OPENROUTER_CHAT_URL ?? "https://openrouter.ai/api/v1/chat/completions",
    openRouterChatModel:process.env.OPENROUTER_CHAT_MODEL ?? "openai/gpt-oss-120b",
    openRouterUsdPer1MInputTokens:numberFromEnv("OPENROUTER_USD_PER_1M_INPUT_TOKENS",0.15),
    openRouterUsdPer1MOutputTokens:numberFromEnv("OPENROUTER_USD_PER_1M_OUTPUT_TOKENS",0.60),
    groqLedgerLockTimeoutMs:numberFromEnv("GROQ_LEDGER_LOCK_TIMEOUT_MS",5000),
    groqLedgerStaleLockMs:numberFromEnv("GROQ_LEDGER_STALE_LOCK_MS",120000),
    groqMaxCompletionTokens:numberFromEnv("GROQ_MAX_COMPLETION_TOKENS",1024),
    controlAuthMode:controlAuthModeFromEnv(),
    cfAccessTeamDomain:process.env.AGENT_CORE_CF_ACCESS_TEAM_DOMAIN || undefined,
    cfAccessAudiences:(process.env.AGENT_CORE_CF_ACCESS_AUD ?? "").split(",").map((s)=>s.trim()).filter(Boolean)
  };
}