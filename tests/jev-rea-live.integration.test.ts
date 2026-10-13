import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { JevProvider } from "../src/providers/jev.js";
import { DecisionService } from "../src/services/decision.js";
import { routeReaLocalHandoff } from "../src/rea-local/route.js";
import { REA_SYNTHETIC_APP } from "./helpers/test-runtime-config.js";

const liveEnabled =
  process.env.LIVE_JEV_REA === "1" &&
  Boolean(process.env.OPENROUTER_API_KEY) &&
  (process.env.REA_LOCAL_HANDOFF_ENABLED ?? "false").toLowerCase() === "true";

describe.skipIf(!liveEnabled)("live Jev + REA route integration", () => {
  it("returns structured ALLOW_HANDOFF for synthetic sample (no secrets in payload)", async () => {
    const config = loadConfig();
    const service = new DecisionService(config, new JevProvider(config));
    const result = await routeReaLocalHandoff({
      config,
      decisionService: service,
      request: {
        project: "agent-core",
        task_id: "live-rea-smoke",
        task: "Perform bounded read-only JavaScript analysis of the local synthetic inbox sample.",
        tool_arguments: {
          input_path: REA_SYNTHETIC_APP,
          format: "directory",
          detail: "summary"
        },
        rea_mcp_connected: true
      }
    });

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/sk-or-[a-z0-9]/i);
    expect(serialized).not.toContain(process.env.OPENROUTER_API_KEY ?? "__none__");
    expect(["ALLOW_HANDOFF", "HUMAN_REVIEW", "FALLBACK"]).toContain(result.disposition);
    if (result.disposition === "ALLOW_HANDOFF") {
      expect(result.selected_tool).toBe("analyze_javascript_application");
      expect(result.handoff?.tool).toBe("analyze_javascript_application");
    }
  });
});
