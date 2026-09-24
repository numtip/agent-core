import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { CapabilityRegistry, createDefaultCapabilityRegistry } from "../src/capability-registry.js";
import { unifiedRoute } from "../src/unified-router.js";
import type { RuntimeConfig } from "../src/config.js";
import type { JevProvider } from "../src/providers/jev.js";

const config: RuntimeConfig = {
  env:"test", host:"127.0.0.1", port:8787, openRouterApiKey:"test",
  openRouterDecisionsUrl:"https://example.invalid", jevModel:"~typesafe/jev-latest",
  requestTimeoutMs:1000, confidenceExecute:0.85, confidenceReview:0.60,
  authRequired:true, projectKeys:{"52clips":"secret-52"},
  projectScopes:{"52clips":["decision","route","qa","context","metrics"]},
  rateLimitMax:100, rateLimitWindowMs:60000, auditLogPath: null,playwrightMcpExecutionEnabled:false,playwrightMcpEndpoint:"http://127.0.0.1:8791/mcp",playwrightMcpTimeoutMs:5000
};

const provider = { decide: async () => ({ result:"NOOP", confidence:0.99, providerRequestId:"req-test" }) } as unknown as JevProvider;
const headers={"x-agent-project":"52clips","x-agent-project-token":"secret-52"};

describe("Agent Core v2 capability registry",()=>{
  it("activates Playwright only as a policy-controlled handoff capability",()=>{
    const registry=createDefaultCapabilityRegistry();
    const playwright=registry.get("mcp.playwright");
    expect(playwright?.status).toBe("ACTIVE");
    expect(playwright?.metadata.execution_mode).toBe("HANDOFF");
    expect(playwright?.metadata.live_transport_requires_runtime_adapter).toBe(true);
    expect(registry.candidates({project:"52clips",operation:"READ"}).some((x)=>x.id==="mcp.playwright")).toBe(true);
  });

  it("rejects duplicate capability ids",()=>{
    const registry=new CapabilityRegistry([]);
    registry.register({id:"tool.test",kind:"TOOL",description:"test",tags:[],operations:["READ"],projects:["*"],risk:"LOW",status:"ACTIVE",priority:50,metadata:{}});
    expect(()=>registry.register({id:"tool.test",kind:"TOOL",description:"test",tags:[],operations:["READ"],projects:["*"],risk:"LOW",status:"ACTIVE",priority:50,metadata:{}})).toThrow(/CAPABILITY_EXISTS/);
  });
});

describe("Agent Core v2 unified router",()=>{
  it("routes deterministic work to deterministic runtime",()=>{
    const result=unifiedRoute(createDefaultCapabilityRegistry(),{project:"52clips",task:"validate manifest",operation:"READ",complexity:"deterministic",sensitivity:"standard",cost_preference:"balanced",required_tags:[],preferred_tags:[],include_planned:false,limit:5,targets:[]});
    expect(result.disposition).toBe("ROUTE");
    expect(result.selected?.id).toBe("deterministic.runtime");
  });

  it("preserves hard-policy approval gates",()=>{
    const result=unifiedRoute(createDefaultCapabilityRegistry(),{project:"52clips",task:"publish production",operation:"WRITE",environment:"production",complexity:"simple",sensitivity:"standard",cost_preference:"quality",required_tags:[],preferred_tags:[],include_planned:false,limit:5,targets:[]});
    expect(result.disposition).toBe("HUMAN_REVIEW");
    expect(result.reason).toBe("PRODUCTION_WRITE_REQUIRES_APPROVAL");
  });

  it("exposes protected registry and route endpoints",async()=>{
    const app=buildApp({config,provider});
    const capabilities=await app.inject({method:"GET",url:"/v2/capabilities",headers});
    expect(capabilities.statusCode).toBe(200);
    expect(capabilities.json().capabilities.length).toBeGreaterThan(0);
    const route=await app.inject({method:"POST",url:"/v2/route",headers,payload:{project:"52clips",task:"run tests",operation:"READ",complexity:"deterministic"}});
    expect(route.statusCode).toBe(200);
    expect(route.json().selected.id).toBe("deterministic.runtime");
    await app.close();
  });
});
