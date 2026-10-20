import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import { groqRuntimeDefaults, loadConfig, type RuntimeConfig } from "./config.js";
import { JevProvider } from "./providers/jev.js";
import { decisionRequestSchema, decisionResponseSchema } from "./schemas.js";
import { DecisionService, DecisionUnavailableError } from "./services/decision.js";
import { authenticateProject, hasScope } from "./auth.js";
import { RateLimiter } from "./rate-limit.js";
import { AuditLogger, Metrics } from "./telemetry.js";
import { contextRequestSchema, selectContext } from "./context.js";
import { contextGovernorRequestSchema, governContext } from "./context-governor.js";
import { knowledgeQuerySchema, queryKnowledgeFabric } from "./knowledge-fabric.js";
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
import { DisabledMcpClient, McpUnavailableError, newReceiptId, PlaywrightMcpClient, type McpPlaywrightClient } from "./mcp-playwright.js";
import { reaLocalRouteRequestSchema } from "./rea-local/schemas.js";
import { routeReaLocalHandoff } from "./rea-local/route.js";
import { inferenceCompleteRequestSchema, inferenceCompleteResponseSchema } from "./inference/schemas.js";
import { InferenceBudgetExceededError } from "./inference/cost-guard.js";
import { InferencePilotBlockedError, InferenceService, InferenceUnavailableError } from "./services/inference.js";
import { z } from "zod";

export type AppDependencies = { config?:RuntimeConfig; provider?:JevProvider; metrics?:Metrics; audit?:AuditLogger; mcp?:McpPlaywrightClient; inference?:InferenceService };

export function buildApp(deps:AppDependencies={}) {
  const config=deps.config ?? loadConfig();
  const provider=deps.provider ?? new JevProvider(config);
  const service=new DecisionService(config,provider);
  const inference=deps.inference ?? new InferenceService(config);
  const metrics=deps.metrics ?? new Metrics();
  const audit=deps.audit ?? new AuditLogger(config.auditLogPath);
  const limiter=new RateLimiter(config.rateLimitMax,config.rateLimitWindowMs);
  const app=Fastify({logger:true});
  const subgoals=new SubgoalRegistry();
  const capabilities=createDefaultCapabilityRegistry();
  const mcp:McpPlaywrightClient=deps.mcp ?? new PlaywrightMcpClient({
    enabled:config.playwrightMcpExecutionEnabled,
    endpoint:config.playwrightMcpEndpoint,
    timeoutMs:config.playwrightMcpTimeoutMs
  });

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

  app.get("/v1/health",async()=>{
    const groq=groqRuntimeDefaults(config);
    return {status:"ok",service:"agent-core",version:"0.7.0",api_versions:["v1","v2"],jev_model:config.jevModel,provider_configured:Boolean(config.openRouterApiKey),groq_inference_enabled:groq.groqEnabled && Boolean(config.groqApiKey),groq_model:groq.groqModel,groq_fallback_openrouter:groq.groqFallbackOpenRouter,auth_required:config.authRequired};
  });

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
    // Browser-class capabilities additionally require the explicit `browser` scope:
    // capability availability must never outrank project scope (V2 security invariant).
    const selectedId=(result.selected && "id" in result.selected) ? String(result.selected.id) : null;
    if(selectedId?.startsWith("mcp.") && request.projectIdentity && !hasScope(request.projectIdentity,"browser")){
      metrics.increment("browser_scope_denials");
      await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:"GATEWAY_INTERCEPT",result:"FORBIDDEN_BROWSER_SCOPE",latency_ms:Date.now()-started,fallback:false});
      return reply.code(403).send({error:"FORBIDDEN",scope:"browser",capability_id:selectedId});
    }
    const latency=Date.now()-started;
    metrics.increment("gateway_requests");
    if(result.disposition==="APPROVAL_REQUIRED")metrics.increment("policy_blocks");
    metrics.observeLatency(latency);
    await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:"GATEWAY_INTERCEPT",result:selectedId ?? result.disposition,latency_ms:latency,fallback:false});
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

  app.post("/v2/knowledge/query",{preHandler:guard("context")},async(request,reply)=>{
    const parsed=knowledgeQuerySchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    const started=Date.now();
    const result=queryKnowledgeFabric(parsed.data);
    metrics.increment("knowledge_queries");
    if(result.disposition==="CONTEXT_READY")metrics.increment("knowledge_context_ready");
    metrics.observeLatency(Date.now()-started);
    await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:"KNOWLEDGE_QUERY",result:result.disposition,task_id:parsed.data.task_id,latency_ms:Date.now()-started,fallback:false});
    return result;
  });

  app.get("/v2/inference/budget",{preHandler:guard("inference")},async(request,reply)=>{
    try{
      return await inference.budgetStatus();
    }catch(error){
      if(error instanceof InferencePilotBlockedError){
        return reply.code(503).send({error:"GROQ_PILOT_BLOCKED",message:error.message});
      }
      throw error;
    }
  });

  app.post("/v2/inference/complete",{preHandler:guard("inference")},async(request,reply)=>{
    const parsed=inferenceCompleteRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    const started=Date.now();
    try{
      const result=inferenceCompleteResponseSchema.parse(await inference.complete(parsed.data));
      const latency=Date.now()-started;
      metrics.increment("inference_requests");
      metrics.increment(`inference_provider_${result.provider}`);
      if(result.fallback)metrics.increment("inference_fallbacks");
      metrics.observeLatency(latency);
      await audit.write({
        timestamp:new Date().toISOString(),
        project:parsed.data.project,
        route:request.url,
        action:"INFERENCE_COMPLETE",
        result:result.provider,
        task_id:parsed.data.task_id,
        fallback:result.fallback,
        latency_ms:latency,
        provider_request_id:result.provider_request_id,
        inference_provider:result.provider,
        inference_model:result.model,
        prompt_tokens:result.usage.prompt_tokens,
        completion_tokens:result.usage.completion_tokens,
        estimated_cost_usd:result.estimated_cost_usd
      });
      return result;
    }catch(error){
      metrics.increment("inference_errors");
      if(error instanceof InferenceBudgetExceededError){
        await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:"INFERENCE_DENIED",result:"BUDGET_EXCEEDED",task_id:parsed.data.task_id,fallback:false,latency_ms:Date.now()-started});
        return reply.code(402).send({error:"INFERENCE_BUDGET_EXCEEDED",budget_usd:error.budgetUsd,spent_usd:error.ledger.spent_usd,month:error.ledger.month});
      }
      if(error instanceof InferenceUnavailableError){
        await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:"INFERENCE_DENIED",result:"UNAVAILABLE",task_id:parsed.data.task_id,fallback:false,latency_ms:Date.now()-started});
        return reply.code(503).send({error:"INFERENCE_UNAVAILABLE",message:error.message});
      }
      if(error instanceof InferencePilotBlockedError){
        await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:"INFERENCE_DENIED",result:"PILOT_BLOCKED",task_id:parsed.data.task_id,fallback:false,latency_ms:Date.now()-started});
        return reply.code(503).send({error:"GROQ_PILOT_BLOCKED",message:error.message});
      }
      throw error;
    }
  });

  app.post("/v2/rea/route",{preHandler:guard("route")},async(request,reply)=>{
    const parsed=reaLocalRouteRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});
    const started=Date.now();
    const result=await routeReaLocalHandoff({config,request:parsed.data,decisionService:service});
    metrics.increment("rea_local_routes");
    if(result.disposition==="ALLOW_HANDOFF")metrics.increment("rea_local_handoffs");
    if(result.disposition==="DENY"||result.disposition==="HUMAN_REVIEW"||result.disposition==="FALLBACK")metrics.increment("rea_local_policy_blocks");
    await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,action:"REA_LOCAL_ROUTE",result:result.disposition,task_id:parsed.data.task_id,confidence:result.jev?.confidence,fallback:result.jev?.fallback??false,latency_ms:Date.now()-started,provider_request_id:result.jev?.provider_request_id??null});
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

  // V2-8 live browser execution. The mandated pipeline is:
  //   auth -> project scope -> hard policy -> browser control -> URL/SSRF guard ->
  //   prompt-injection guard -> approval gates -> MCP runtime
  // Nothing is executed unless browser-control's own plan says READY.
  app.post("/v2/browser/execute",{preHandler:guard("browser")},async(request,reply)=>{
    const parsed=browserPlanRequestSchema.safeParse(request.body);
    if(!parsed.success)return reply.code(400).send({error:"INVALID_REQUEST",details:parsed.error.flatten()});
    if(request.projectIdentity && request.projectIdentity.project!==parsed.data.project)return reply.code(403).send({error:"PROJECT_MISMATCH"});

    const plan=planBrowserAction(parsed.data);
    const started=Date.now();
    const base={
      project:parsed.data.project,
      task_id:parsed.data.task_id??null,
      url:parsed.data.url,
      action:parsed.data.action
    };

    // Hard policy / SSRF / injection / approval gates decided by browser-control, not here.
    if(plan.disposition!=="READY"){
      metrics.increment("browser_execution_blocks");
      await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,
        action:parsed.data.action,result:plan.disposition,task_id:parsed.data.task_id,latency_ms:Date.now()-started,fallback:false});
      return reply.code(200).send({...plan,executed:false});
    }

    // Kill switch: live execution stays off unless the operator enabled it.
    if(!mcp.isEnabled()){
      metrics.increment("browser_execution_disabled");
      const disabled={...plan,executed:false,reason:"MCP_EXECUTION_DISABLED",
        execution:{enabled:false,endpoint:mcp.endpoint(),tool:null},
        receipt:{receipt_id:newReceiptId(),project:parsed.data.project,task_id:parsed.data.task_id??null,
                 url:plan.receipt?.url??parsed.data.url,action:parsed.data.action,executed_at:new Date().toISOString(),
                 latency_ms:Date.now()-started,mcp:{endpoint:mcp.endpoint(),tool:null,session_id:null}}};
      await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,
        action:parsed.data.action,result:"MCP_EXECUTION_DISABLED",task_id:parsed.data.task_id,latency_ms:Date.now()-started,fallback:false});
      return reply.code(200).send(disabled);
    }

    if(plan.risk==="HIGH"){
      // defensive: write-like browser risk must never reach the transport
      metrics.increment("browser_execution_blocks");
      await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,
        action:parsed.data.action,result:"HIGH_RISK_BLOCKED",task_id:parsed.data.task_id,latency_ms:Date.now()-started,fallback:false});
      return reply.code(200).send({...plan,executed:false,reason:"HIGH_RISK_REQUIRES_APPROVAL"});
    }

    try{
      const navigation=await mcp.callTool("browser_navigate",{url:parsed.data.url},config.playwrightMcpTimeoutMs);
      let toolResult=navigation;
      let typed:null|{tool:string;input_chars:number}=null;
      if(parsed.data.action==="BROWSER_INPUT"){
        if(!parsed.data.element_ref){
          metrics.increment("browser_execution_incomplete");
          await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,
            action:parsed.data.action,result:"NEEDS_ELEMENT_REF",task_id:parsed.data.task_id,latency_ms:Date.now()-started,fallback:false});
          return reply.code(200).send({...plan,executed:false,reason:"BROWSER_INPUT_REQUIRES_ELEMENT_REF",
            execution:{enabled:true,endpoint:mcp.endpoint(),tool:"browser_navigate"}});
        }
        toolResult=await mcp.callTool("browser_type",{element:parsed.data.element_ref,text:parsed.data.input_text??"",ref:parsed.data.element_ref},config.playwrightMcpTimeoutMs);
        typed={tool:"browser_type",input_chars:(parsed.data.input_text??"").length};
      }
      metrics.increment("browser_executions");
      metrics.observeLatency(Date.now()-started);
      const receipt={
        receipt_id:newReceiptId(),
        ...base,
        executed_at:new Date().toISOString(),
        latency_ms:Date.now()-started,
        mcp:{endpoint:mcp.endpoint(),tool:toolResult.tool,session_id:toolResult.session_id,mcp_latency_ms:toolResult.latency_ms}
      };
      await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,
        action:parsed.data.action,result:toolResult.isError?"MCP_TOOL_ERROR":"MCP_EXECUTED",
        task_id:parsed.data.task_id,latency_ms:Date.now()-started,fallback:false});
      return reply.code(200).send({
        disposition:"EXECUTED",
        executed:true,
        plan:{policy:plan.policy,injection:plan.injection,risk:plan.risk},
        receipt,
        result:{tool:toolResult.tool,is_error:toolResult.isError,text:toolResult.text.slice(0,4000),typed}
      });
    }catch(error){
      const unavailable=error instanceof McpUnavailableError;
      metrics.increment(unavailable?"browser_execution_unavailable":"browser_execution_failures");
      await audit.write({timestamp:new Date().toISOString(),project:parsed.data.project,route:request.url,
        action:parsed.data.action,result:unavailable?"MCP_UNAVAILABLE":"MCP_TOOL_ERROR",
        task_id:parsed.data.task_id,latency_ms:Date.now()-started,fallback:false});
      return reply.code(unavailable?503:502).send({
        error:unavailable?"MCP_UNAVAILABLE":"MCP_TOOL_ERROR",
        reason:error instanceof Error?error.message:"unknown MCP failure",
        executed:false,
        plan:{policy:plan.policy,injection:plan.injection,risk:plan.risk},
        execution:{enabled:true,endpoint:mcp.endpoint(),tool:"browser_navigate"}
      });
    }
  });

  app.get("/v1/projects",{preHandler:guard("metrics")},async()=>({projects:listProjects()}));
  app.get("/v1/metrics",{preHandler:guard("metrics")},async()=>metrics.snapshot());
  app.get("/v1/control-metrics",async()=>metrics.snapshot());
  app.get("/control",async(_request,reply)=>reply.type("text/html; charset=utf-8").send(dashboardHtml()));

  return app;
}
