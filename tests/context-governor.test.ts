import { describe, expect, it } from "vitest";
import { governContext } from "../src/context-governor.js";
import { buildApp } from "../src/app.js";
import type { RuntimeConfig } from "../src/config.js";
import type { JevProvider } from "../src/providers/jev.js";

describe("V2 context governor",()=>{
  it("pins protected requirements even when old and lexically unrelated",()=>{
    const result=governContext({
      project:"goffice2026",query:"dashboard links",max_items:1,
      items:[
        {id:"req",text:"Production deploy requires approval.",protected_reasons:["APPROVAL_REQUIREMENT"],age_turns:999,importance:0.1},
        {id:"task",text:"dashboard links dashboard links",age_turns:0,importance:0.5}
      ]
    });
    expect(result.receipt.pinned_ids).toContain("req");
    expect(result.bundle.some((x)=>x.id==="req")).toBe(true);
  });

  it("compacts long selected context deterministically",()=>{
    const text=`important-symbol ${"x".repeat(2500)}`;
    const result=governContext({project:"handbook",query:"important-symbol",compress_after_chars:300,items:[{id:"long",text,importance:0.5}]});
    const entry=result.entries.find((x)=>x.id==="long");
    expect(entry?.disposition).toBe("COMPRESS");
    expect(entry?.output_chars).toBeLessThan(entry?.original_chars ?? 0);
    expect(result.receipt.reduction_ratio).toBeGreaterThan(0);
  });
});

const config:RuntimeConfig={
  env:"test",host:"127.0.0.1",port:8787,openRouterApiKey:"test",openRouterDecisionsUrl:"https://example.invalid",jevModel:"~typesafe/jev-latest",
  requestTimeoutMs:1000,confidenceExecute:0.85,confidenceReview:0.60,authRequired:true,
  projectKeys:{goffice2026:"secret"},projectScopes:{goffice2026:["context"]},rateLimitMax:100,rateLimitWindowMs:60000,auditLogPath:null
};
const provider={decide:async()=>({result:"x",confidence:0.9,providerRequestId:"x"})} as unknown as JevProvider;

describe("V2 context governor API",()=>{
  it("enforces project identity and returns a context receipt",async()=>{
    const app=buildApp({config,provider});
    const headers={"x-agent-project":"goffice2026","x-agent-project-token":"secret"};
    const response=await app.inject({method:"POST",url:"/v2/context/govern",headers,payload:{project:"goffice2026",query:"water chart",items:[{id:"a",text:"water chart source"}]}});
    expect(response.statusCode).toBe(200);
    expect(response.json().receipt.receipt_id).toMatch(/^ctx_/);
    await app.close();
  });
});
