import { describe, expect, it } from "vitest";
import { createDefaultCapabilityRegistry } from "../src/capability-registry.js";
import { interceptExecution } from "../src/gateway.js";

describe("REA preflight contracts", () => {
  it("registers mcp.rea as PLANNED HANDOFF with no control-plane execution", () => {
    const rea = createDefaultCapabilityRegistry().get("mcp.rea");
    expect(rea?.status).toBe("PLANNED");
    expect(rea?.metadata.execution_mode).toBe("HANDOFF");
    expect(rea?.metadata.control_plane_execution).toBe(false);
    expect(rea?.metadata.vps_execution).toBe(false);
  });

  it("does not execute REA while capability remains PLANNED", () => {
    const result = interceptExecution(createDefaultCapabilityRegistry(), {
      project: "agent-core",
      task: "analyze sample binary",
      operation: "READ",
      capability_id: "mcp.rea",
      environment: "local",
    });
    expect(result.executed).toBe(false);
    expect(result.disposition).toBe("UNAVAILABLE");
    if ("reason" in result) expect(result.reason).toBe("CAPABILITY_NOT_ACTIVE");
  });
});
