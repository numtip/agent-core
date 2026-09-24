import { describe, expect, it } from "vitest";
import { createDefaultCapabilityRegistry } from "../src/capability-registry.js";
import { interceptExecution, searchCapabilities } from "../src/gateway.js";
import { buildApp } from "../src/app.js";
import type { RuntimeConfig } from "../src/config.js";
import type { JevProvider } from "../src/providers/jev.js";

const registry=createDefaultCapabilityRegistry();

describe("V2 gateway",()=>{
  it("progressively discloses matching capabilities",()=>{
    const result=searchCapabilities(registry,{project:"goffice2026",operation:"READ",query:"git",disclosure_level:"summary"});
    expect(result.count).toBeGreaterThan(0);
    expect(result.capabilities[0]).toHaveProperty("id");
    expect(result.capabilities[0]).not.toHaveProperty("metadata");
  });

  it("requires approval before production writes",()=>{
    const result=interceptExecution(registry,{project:"goffice2026",task:"publish",operation:"WRITE",environment:"production"});
    expect(result.disposition).toBe("APPROVAL_REQUIRED");
    expect(result.executed).toBe(false);
  });

  it("returns a handoff contract for project-side agents",()=>{
    const result=interceptExecution(registry,{project:"goffice2026",task:"fix code",operation:"WRITE",capability_id:"agent.cursor",environment:"local"});
    expect(result.disposition).toBe("HANDOFF");
    expect(result.executed).toBe(false);
  });
});

const config:RuntimeConfig={
  env:"test",host:"127.0.0.1",port:8787,openRouterApiKey:"test",
  openRouterDecisionsUrl:"https://example.invalid",jevModel:"~typesafe/jev-latest",
  requestTimeoutMs:1000,confidenceExecute:0.85,confidenceReview:0.60,
  authRequired:true,projectKeys:{goffice2026:"secret"},projectScopes:{goffice2026:["route"]},
  rateLimitMax:100,rateLimitWindowMs:60000,auditLogPath:null
};
const provider={decide:async()=>({result:"x",confidence:0.9,providerRequestId:"x"})} as unknown as JevProvider;

describe("V2 gateway API",()=>{
  it("exposes search and execute behind project auth",async()=>{
    const app=buildApp({config,provider});
    const headers={"x-agent-project":"goffice2026","x-agent-project-token":"secret"};
    const search=await app.inject({method:"POST",url:"/v2/capabilities/search",headers,payload:{project:"goffice2026",operation:"READ",query:"browser",include_planned:true}});
    expect(search.statusCode).toBe(200);
    expect(search.json().capabilities.some((x:{id:string})=>x.id==="mcp.playwright")).toBe(true);
    const execute=await app.inject({method:"POST",url:"/v2/execute",headers,payload:{project:"goffice2026",task:"deploy",operation:"WRITE",environment:"production"}});
    expect(execute.statusCode).toBe(200);
    expect(execute.json().disposition).toBe("APPROVAL_REQUIRED");
    await app.close();
  });
});
