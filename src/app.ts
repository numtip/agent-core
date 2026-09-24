import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { loadConfig, type RuntimeConfig } from "./config.js";
import { JevProvider } from "./providers/jev.js";
import { decisionRequestSchema, decisionResponseSchema } from "./schemas.js";
import { DecisionService, DecisionUnavailableError } from "./services/decision.js";
import { authenticateProject, hasScope } from "./auth.js";
import { RateLimiter } from "./rate-limit.js";
import { AuditLogger, Metrics } from "./telemetry.js";
import { contextRequestSchema, selectContext } from "./context.js";
import { contextGovernorRequestSchema, governContext } from "./context-governor.js";
import { browserPlanRequestSchema, planBrowserAction } from "./browser-control.js";
import { listProjects } from "./projects.js";
import { evaluateHardPolicy } from "./policy.js";
import { subagentRequestSchema, planSubagent } from "./subagent.js";
import { dashboardHtml } from "./dashboard.js";
import { advancedRouteSchema, advancedRoute } from "./advanced-router.js";
import { SubgoalRegistry } from "./subgoal-registry.js";
import { createDefaultCapabilityRegistry } from "./capability-registry.js";
import { unifiedRoute, unifiedRouteRequestSchema } from "./unified-router.js";
import { capabilitySearchSchema, executeRequestSchema, interceptExecution, searchCapabilities, discloseCapability } from "./gateway.js";
import { z } from "zod";

export type AppDependencies = { config?:RuntimeConfig; provider?:JevProvider; metrics?:Metrics; audit?:AuditLogger };

export function buildApp(deps:AppDependencies={}) {
  const config=deps.config ?? loadConfig();
  const provider=deps.provider ?? new JevProvider(config);
  const service=new DecisionService(config,provider);
  const metrics=deps.metrics ?? new Metrics();
  const audit=deps.audit ?? new AuditLogger(config.auditLogPath);
  const limiter=new RateLimiter(config.rateLimitMax,config.rateLimitWindowMs);
  const app=Fastify({logger:true});
  const subgoals=new SubgoalRegistry();
  const capabilities=createDefaultCapabilityRegistry();

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

  app.get("/v1/health",async()=>({status:"ok",service:"agent-core",version:"0.6.0",api_versions:["v1","v2"],jev_model:config.jevModel,provider_configured:Boolean(config.openRouterApiKey),auth_required:config.authRequired}));

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
    const plan=planSubagent(parsed.data);
    if(!subgoals.register(plan.dedupe_key))return {delegate:false,duplicate:true,dedupe_key:plan.dedupe_key,policy};
    metrics.increment("subagent_plans"); return {...plan,duplicate:false,policy};
  });

  app.post("/v1/subagent/complete",{preHandler:guard("route")},async(request,reply)=>{
    const parsed=z.object({key:z.string().min(1)}).safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST"});
    subgoals.complete(parsed.data.key);
    return {completed:true,key:parsed.data.key};
  });

  app.post("/v1/advanced-route",{preHandler:guard("route")},async(request,reply)=>{
    const parsed=advancedRouteSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    const policy=evaluateHardPolicy({project:parsed.data.project,operation:parsed.data.operation});
    if(policy.disposition!=="ALLOW")return {tier:"HUMAN_REVIEW",reason:policy.reason,policy};
    metrics.increment("advanced_routes");
    return {...advancedRoute(parsed.data),policy};
  });

  app.get("/v2/capabilities",{preHandler:guard("route")},async()=>({schema_version:2,capabilities:capabilities.list()}));

  app.get("/v2/capabilities/:id",{preHandler:guard("route")},async(request,reply)=>{
    const parsed=z.object({id:z.string().min(1)}).safeParse(request.params);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST"});
    const capability=capabilities.get(parsed.data.id);
    if(!capability)return reply.code(404).send({error:"CAPABILITY_NOT_FOUND"});
    return discloseCapability(capability,"full");
  });

  app.post("/v2/capabilities/search",{preHandler:guard("route")},async(request,reply)=>{
    const parsed=capabilitySearchSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    metrics.increment("capability_searches");
    return searchCapabilities(capabilities,parsed.data);
  });

  app.post("/v2/route",{preHandler:guard("route")},async(request,reply)=>{
    const parsed=unifiedRouteRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    const started=Date.now();
    const result=unifiedRoute(capabilities,parsed.data);
    const latency=Date.now()-started;
    metrics.increment("v2_routes");
    metrics.observeLatency(latency);
    await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:"UNIFIED_ROUTE",result:result.selected?.id ?? result.disposition,latency_ms:latency,fallback:false});
    return result;
  });

  app.post("/v2/execute",{preHandler:guard("route")},async(request,reply)=>{
    const parsed=executeRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    const started=Date.now();
    const result=interceptExecution(capabilities,parsed.data);
    const latency=Date.now()-started;
    metrics.increment("gateway_requests");
    if(result.disposition==="APPROVAL_REQUIRED")metrics.increment("policy_blocks");
    metrics.observeLatency(latency);
    await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:"GATEWAY_INTERCEPT",result:result.selected && "id" in result.selected ? String(result.selected.id) : result.disposition,latency_ms:latency,fallback:false});
    return result;
  });

  app.post("/v2/context/govern",{preHandler:guard("context")},async(request,reply)=>{
    const parsed=contextGovernorRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    const result=governContext(parsed.data);
    metrics.increment("context_governor_requests");
    const reduction=Math.max(0,result.receipt.original_chars-result.receipt.output_chars);
    metrics.increment("context_chars_reduced",reduction);
    await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:"CONTEXT_GOVERN",result:result.receipt.receipt_id,task_id:parsed.data.task_id,fallback:false});
    return result;
  });

  app.post("/v2/browser/plan",{preHandler:guard("browser")},async(request,reply)=>{
    const parsed=browserPlanRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    const result=planBrowserAction(parsed.data);
    metrics.increment("browser_plans");
    if(result.disposition==="DENY" || result.disposition==="HUMAN_REVIEW" || result.disposition==="EXPLICIT_WRITE_SCOPE_REQUIRED")metrics.increment("browser_policy_blocks");
    await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:parsed.data.action,result:result.disposition,task_id:parsed.data.task_id,fallback:false});
    return result;
  });

  app.get("/v1/projects",{preHandler:guard("metrics")},async()=>({projects:listProjects()}));
  app.get("/v1/metrics",{preHandler:guard("metrics")},async()=>metrics.snapshot());
  app.get("/v1/control-metrics",async()=>metrics.snapshot());
  app.get("/control",async(_request,reply)=>reply.type("text/html; charset=utf-8").send(dashboardHtml()));

  return app;
}
