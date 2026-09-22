import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { loadConfig, type RuntimeConfig } from "./config.js";
import { JevProvider } from "./providers/jev.js";
import { decisionRequestSchema, decisionResponseSchema } from "./schemas.js";
import { DecisionService, DecisionUnavailableError } from "./services/decision.js";
import { authenticateProject, hasScope } from "./auth.js";
import { RateLimiter } from "./rate-limit.js";
import { AuditLogger, Metrics } from "./telemetry.js";
import { contextRequestSchema, selectContext } from "./context.js";
import { listProjects } from "./projects.js";
import { evaluateHardPolicy } from "./policy.js";
import { subagentRequestSchema, planSubagent } from "./subagent.js";
import { dashboardHtml } from "./dashboard.js";

export type AppDependencies = { config?:RuntimeConfig; provider?:JevProvider; metrics?:Metrics; audit?:AuditLogger };

export function buildApp(deps:AppDependencies={}) {
  const config=deps.config ?? loadConfig();
  const provider=deps.provider ?? new JevProvider(config);
  const service=new DecisionService(config,provider);
  const metrics=deps.metrics ?? new Metrics();
  const audit=deps.audit ?? new AuditLogger(config.auditLogPath);
  const limiter=new RateLimiter(config.rateLimitMax,config.rateLimitWindowMs);
  const app=Fastify({logger:true});

  function guard(scope:string){
    return async (request:FastifyRequest,reply:FastifyReply)=>{
      if(!config.authRequired)return;
      const identity=authenticateProject(config,request);
      if(!identity)return reply.code(401).send({error:"UNAUTHORIZED"});
      request.projectIdentity=identity;
      if(!hasScope(identity,scope))return reply.code(403).send({error:"FORBIDDEN",scope});
      if(!limiter.allow(identity.project+":"+scope)){ metrics.increment("rate_limited"); return reply.code(429).send({error:"RATE_LIMITED"}); }
    };
  }

  app.get("/v1/health",async()=>({status:"ok",service:"agent-core",version:"0.2.0",jev_model:config.jevModel,provider_configured:Boolean(config.openRouterApiKey),auth_required:config.authRequired}));

  async function handleDecision(request:FastifyRequest,reply:FastifyReply){
    const parsed=decisionRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    const started=Date.now();
    try{
      const result=decisionResponseSchema.parse(await service.decide(parsed.data));
      const latency=Date.now()-started; metrics.increment("decisions"); metrics.observeLatency(latency); if(result.fallback)metrics.increment("fallbacks");
      await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:parsed.data.decision_type,result:result.result,task_id:parsed.data.task_id,decision_type:parsed.data.decision_type,confidence:result.confidence,fallback:result.fallback,latency_ms:latency,provider_request_id:result.provider_request_id});
      return result;
    }catch(error){
      metrics.increment("provider_errors");
      if(error instanceof DecisionUnavailableError)return reply.code(503).send({error:"DECISION_UNAVAILABLE",message:error.message});
      throw error;
    }
  }

  app.post("/v1/decision",{preHandler:guard("decision")},handleDecision);
  app.post("/v1/route",{preHandler:guard("route")},handleDecision);
  app.post("/v1/qa",{preHandler:guard("qa")},handleDecision);

  app.post("/v1/context",{preHandler:guard("context")},async(request,reply)=>{
    const parsed=contextRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    metrics.increment("context_requests"); return selectContext(parsed.data);
  });

  app.post("/v1/subagent",{preHandler:guard("route")},async(request,reply)=>{
    const parsed=subagentRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    const policy=evaluateHardPolicy({project:parsed.data.project,operation:parsed.data.operation});
    if(policy.disposition!=="ALLOW")return {delegate:false,policy};
    metrics.increment("subagent_plans"); return {...planSubagent(parsed.data),policy};
  });

  app.get("/v1/projects",{preHandler:guard("metrics")},async()=>({projects:listProjects()}));
  app.get("/v1/metrics",{preHandler:guard("metrics")},async()=>metrics.snapshot());
  app.get("/control",{preHandler:guard("metrics")},async(_request,reply)=>reply.type("text/html; charset=utf-8").send(dashboardHtml()));

  return app;
}