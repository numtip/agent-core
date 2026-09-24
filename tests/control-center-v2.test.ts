import { describe, expect, it } from "vitest";
import { dashboardHtml } from "../src/dashboard.js";

describe("Agent Core v2 control center",()=>{
  it("shows core v2 modules and browser activation caveat",()=>{
    const html=dashboardHtml();
    for(const label of ["Unified Router","Gateway","Context Governor","Browser Control","Supervisor"]) expect(html).toContain(label);
    expect(html).toContain("HANDOFF");
    expect(html).toContain("Cloudflare Access");
  });
});
