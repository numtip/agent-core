import { describe, expect, it } from "vitest";
import { evaluateHardPolicy } from "../src/policy.js";
import { selectContext } from "../src/context.js";

describe("hard policy",()=>{
  it("denies secret targets before AI",()=>{
    expect(evaluateHardPolicy({project:"goffice2026",operation:"READ",targets:[".env"]}).disposition).toBe("DENY");
  });
  it("keeps dbplant read-only by default",()=>{
    expect(evaluateHardPolicy({project:"dbplant",operation:"WRITE",targets:["plants"]}).disposition).toBe("ASK");
  });
  it("requires approval for production writes",()=>{
    expect(evaluateHardPolicy({project:"goffice2026",operation:"WRITE",environment:"production"}).disposition).toBe("ASK");
  });
});

describe("context selection",()=>{
  it("ranks relevant candidates ahead of unrelated content",()=>{
    const result=selectContext({project:"goffice2026",query:"water dashboard chart",limit:2,candidates:[
      {id:"a",path:"src/components/WaterChart.tsx",text:"renders monthly water dashboard chart"},
      {id:"b",path:"src/auth.ts",text:"login session cookies"},
      {id:"c",path:"data/water.json",text:"monthly water usage"}
    ]});
    expect(result.selected[0].id).toBe("a");
    expect(result.selected.map((x)=>x.id)).toContain("c");
  });
});