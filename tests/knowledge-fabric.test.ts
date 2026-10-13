import { describe, expect, it } from "vitest";
import { createDefaultCapabilityRegistry } from "../src/capability-registry.js";
import { queryKnowledgeFabric } from "../src/knowledge-fabric.js";
import { buildApp } from "../src/app.js";
import type { RuntimeConfig } from "../src/config.js";
import type { JevProvider } from "../src/providers/jev.js";

describe("V2-9 Knowledge Fabric",()=>{
  it("registers observation and memory-store handoff capabilities",()=>{
    const registry=createDefaultCapabilityRegistry();
    expect(registry.get("knowledge.observation")?.metadata.execution_mode).toBe("HANDOFF");
    expect(registry.get("knowledge.memory-store")?.operations).toEqual(["READ"]);
  });

  it("returns a read-only OpenWiki handoff when evidence is not supplied",()=>{
    const result=queryKnowledgeFabric({project:"agent-core",query:"deployment architecture",repositories:["numtip/agent-core"]});
    expect(result.disposition).toBe("HANDOFF");
    if(result.disposition!=="HANDOFF") throw new Error("expected HANDOFF");
    expect(result.handoff.capability_id).toBe("knowledge.openwiki");
    expect(result.guardrails.knowledge_is_not_authority).toBe(true);
  });

  it("returns observation handoff for Claude-Mem style GitHub exports",()=>{
    const result=queryKnowledgeFabric({
      project:"agent-core",
      query:"recent gateway changes",
      sources:["observation"],
      memory_repositories:["numtip/agent-core-memory"]
    });
    expect(result.disposition).toBe("HANDOFF");
    if(result.disposition!=="HANDOFF") throw new Error("expected HANDOFF");
    expect(result.reason).toBe("OBSERVATION_READ_HANDOFF");
    expect(result.handoff.capability_id).toBe("knowledge.observation");
  });

  it("drops low-importance unfiltered observations before governing context",()=>{
    const result=queryKnowledgeFabric({
      project:"agent-core",
      query:"deployment",
      importance_min:0.7,
      evidence:[
        {id:"keep",text:"Production deploy requires approval.",kind:"observation",importance:0.9,filtered:true},
        {id:"drop",text:"minor UI note",kind:"observation",importance:0.2,filtered:false}
      ]
    });
    expect(result.disposition).toBe("CONTEXT_READY");
    if(result.disposition!=="CONTEXT_READY") throw new Error("expected CONTEXT_READY");
    expect(result.context.bundle.some((item)=>item.id==="keep")).toBe(true);
    expect(result.context.bundle.some((item)=>item.id==="drop")).toBe(false);
  });

  it("governs returned evidence before exposing it as context",()=>{
    const result=queryKnowledgeFabric({
      project:"goffice2026",
      query:"production deployment",
      max_context_items:1,
      evidence:[
        {id:"deploy",text:"Production deployment requires explicit approval.",path:"docs/DEPLOY.md",repository:"numtip/goffice2026",revision:"abc123",importance:1},
        {id:"noise",text:"unrelated historical note",importance:0}
      ]
    });
    expect(result.disposition).toBe("CONTEXT_READY");
    if(result.disposition!=="CONTEXT_READY") throw new Error("expected CONTEXT_READY");
    expect(result.context.bundle.some((item)=>item.id==="deploy")).toBe(true);
  });
});

const config:RuntimeConfig={
  env:"test",host:"127.0.0.1",port:8787,openRouterApiKey:"test",openRouterDecisionsUrl:"https://example.invalid",jevModel:"~typesafe/jev-latest",
  requestTimeoutMs:1000,confidenceExecute:0.85,confidenceReview:0.60,authRequired:true,
  projectKeys:{goffice2026:"secret"},projectScopes:{goffice2026:["context"]},rateLimitMax:100,rateLimitWindowMs:60000,auditLogPath:null,
  playwrightMcpExecutionEnabled:false,playwrightMcpEndpoint:"http://127.0.0.1:8791/mcp",playwrightMcpTimeoutMs:5000
};
const provider={decide:async()=>({result:"x",confidence:0.9,providerRequestId:"x"})} as unknown as JevProvider;

describe("V2-9 Knowledge Fabric API",()=>{
  it("uses context scope and returns a knowledge receipt",async()=>{
    const app=buildApp({config,provider});
    const response=await app.inject({
      method:"POST",url:"/v2/knowledge/query",
      headers:{"x-agent-project":"goffice2026","x-agent-project-token":"secret"},
      payload:{project:"goffice2026",query:"green office source of truth"}
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().receipt_id).toMatch(/^knw_/);
    expect(response.json().disposition).toBe("HANDOFF");
    await app.close();
  });
});
