import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import type { RuntimeConfig } from "../src/config.js";
import type { JevProvider } from "../src/providers/jev.js";

const config: RuntimeConfig = {
  env:"test", host:"127.0.0.1", port:8787, openRouterApiKey:"test",
  openRouterDecisionsUrl:"https://example.invalid", jevModel:"~typesafe/jev-latest",
  requestTimeoutMs:1000, confidenceExecute:0.85, confidenceReview:0.60,
  authRequired:true, projectKeys:{"52clips":"secret-52"},
  projectScopes:{"52clips":["decision","route","qa","context","metrics"]},
  rateLimitMax:100, rateLimitWindowMs:60000, auditLogPath:null
};

const provider = {
  decide: async () => ({ result:"GENERATE_SUBTITLE", confidence:0.96, providerRequestId:"req-test" })
} as unknown as JevProvider;

const decisionBody = {
  project:"52clips", task_id:"GO-15", decision_type:"NEXT_ACTION",
  state:{subtitle:"missing"},
  question:{ type:"choice", instructions:"Choose next action.", criteria:{GENERATE_SUBTITLE:"Subtitle missing.",READY_FOR_QA:"All assets ready."} },
  fallback_result:"HUMAN_REVIEW"
};

describe("Agent Core platform",()=>{
  it("keeps health public while protecting decisions", async()=>{
    const app=buildApp({config,provider});
    const health=await app.inject({method:"GET",url:"/v1/health"});
    expect(health.statusCode).toBe(200);
    const denied=await app.inject({method:"POST",url:"/v1/decision",payload:decisionBody});
    expect(denied.statusCode).toBe(401);
    await app.close();
  });

  it("accepts a valid project identity", async()=>{
    const app=buildApp({config,provider});
    const response=await app.inject({method:"POST",url:"/v1/decision",headers:{"x-agent-project":"52clips","x-agent-project-token":"secret-52"},payload:decisionBody});
    expect(response.statusCode).toBe(200);
    expect(response.json().disposition).toBe("EXECUTE");
    await app.close();
  });

  it("rejects cross-project body spoofing", async()=>{
    const app=buildApp({config,provider});
    const response=await app.inject({method:"POST",url:"/v1/decision",headers:{"x-agent-project":"52clips","x-agent-project-token":"secret-52"},payload:{...decisionBody,project:"goffice2026"}});
    expect(response.statusCode).toBe(403);
    expect(response.json().error).toBe("PROJECT_MISMATCH");
    await app.close();
  });

  it("returns project registry and metrics to authorized scope", async()=>{
    const app=buildApp({config,provider});
    const headers={"x-agent-project":"52clips","x-agent-project-token":"secret-52"};
    const projects=await app.inject({method:"GET",url:"/v1/projects",headers});
    expect(projects.statusCode).toBe(200);
    expect(projects.json().projects.length).toBeGreaterThanOrEqual(5);
    const metrics=await app.inject({method:"GET",url:"/v1/metrics",headers});
    expect(metrics.statusCode).toBe(200);
    await app.close();
  });
});