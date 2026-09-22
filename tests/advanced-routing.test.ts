import { describe,expect,it } from "vitest";
import { advancedRoute } from "../src/advanced-router.js";
import { SubgoalRegistry } from "../src/subgoal-registry.js";

describe("advanced routing",()=>{
  it("keeps restricted data on restricted frontier tier",()=>{
    expect(advancedRoute({project:"x",task:"inspect infra",sensitivity:"restricted",complexity:"simple",cost_preference:"lowest",operation:"READ"}).tier).toBe("FRONTIER_RESTRICTED");
  });
  it("uses deterministic path when no model is needed",()=>{
    expect(advancedRoute({project:"x",task:"run formatter",sensitivity:"standard",complexity:"deterministic",cost_preference:"quality",operation:"WRITE"}).tier).toBe("DETERMINISTIC");
  });
  it("never auto-routes destructive work to a model",()=>{
    expect(advancedRoute({project:"x",task:"delete release",sensitivity:"standard",complexity:"simple",cost_preference:"balanced",operation:"DESTRUCTIVE"}).tier).toBe("HUMAN_REVIEW");
  });
});

describe("subgoal registry",()=>{
  it("deduplicates active goals and permits them after completion",()=>{
    const r=new SubgoalRegistry();
    expect(r.register("x:goal")).toBe(true);
    expect(r.register("x:goal")).toBe(false);
    r.complete("x:goal");
    expect(r.register("x:goal")).toBe(true);
  });
});