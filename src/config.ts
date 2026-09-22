export type RuntimeConfig = {
  env: string; host: string; port: number;
  openRouterApiKey?: string; openRouterDecisionsUrl: string; jevModel: string;
  requestTimeoutMs: number; confidenceExecute: number; confidenceReview: number;
  authRequired: boolean; projectKeys: Record<string,string>; projectScopes: Record<string,string[]>;
  rateLimitMax: number; rateLimitWindowMs: number; auditLogPath: string | null;
};

function numberFromEnv(name:string,fallback:number){ const raw=process.env[name]; if(!raw)return fallback; const v=Number(raw); if(!Number.isFinite(v))throw new Error(name+" must be a number"); return v; }
function boolFromEnv(name:string,fallback:boolean){ const raw=process.env[name]; if(raw==null)return fallback; return ["1","true","yes","on"].includes(raw.toLowerCase()); }
function jsonObject<T>(name:string,fallback:T):T { const raw=process.env[name]; if(!raw)return fallback; return JSON.parse(raw) as T; }

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
    auditLogPath:process.env.AGENT_CORE_AUDIT_LOG ?? (env==="test" ? null : "./logs/audit.jsonl")
  };
}