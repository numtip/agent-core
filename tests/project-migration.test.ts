import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ids=["52clips","attendance-report-generator","handbook","goffice2026","dbplant"];
function text(id:string){return readFileSync(new URL(`../adapters/${id}/jev.yaml`,import.meta.url),"utf8");}

describe("Agent Core v2 project migration contracts",()=>{
  it("migrates all existing adapters to v2 while retaining v1 compatibility",()=>{
    for(const id of ids){
      const yaml=text(id);
      expect(yaml).toContain("schema_version: 2");
      expect(yaml).toContain("preferred_api: v2");
      expect(yaml).toContain("v1_compatible: true");
      expect(yaml).toContain("context_governor: true");
      expect(yaml).toContain("supervisor: true");
    }
  });

  it("keeps dbplant constrained",()=>{
    const yaml=text("dbplant");
    expect(yaml).toContain("default: read_only");
    expect(yaml).toContain("gateway_execute: false");
    expect(yaml).toContain("browser: false");
    expect(yaml).toContain("destructive: deny");
  });

  it("enables browser planning only for web/publication projects",()=>{
    expect(text("handbook")).toContain("browser: true");
    expect(text("goffice2026")).toContain("browser: true");
    expect(text("52clips")).toContain("browser: false");
    expect(text("attendance-report-generator")).toContain("browser: false");
  });
});
