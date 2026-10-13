import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { JevProvider, type JevProvider as JevProviderType } from "../src/providers/jev.js";
import { DecisionService } from "../src/services/decision.js";
import { routeReaLocalHandoff } from "../src/rea-local/route.js";
import {
  REA_SYNTHETIC_APP,
  REA_TEST_WORKSPACE,
  testRuntimeConfig
} from "./helpers/test-runtime-config.js";

function mockProvider(result: string, confidence: number): JevProviderType {
  return {
    decide: async () => ({ result, confidence, providerRequestId: "jev-mock-v2" })
  } as unknown as JevProviderType;
}

const manifestPath = resolve(REA_TEST_WORKSPACE, "inbox", "web-export", "manifest.json");
const sourceMapPath = resolve(REA_TEST_WORKSPACE, "inbox", "web-export", "app.js.map");

const v2Config = testRuntimeConfig({
  env: "test",
  host: "127.0.0.1",
  port: 8787,
  openRouterApiKey: "test-key",
  openRouterDecisionsUrl: "https://example.invalid/decisions",
  jevModel: "~typesafe/jev-latest",
  requestTimeoutMs: 1000,
  confidenceExecute: 0.85,
  confidenceReview: 0.6,
  authRequired: false,
  projectKeys: {},
  projectScopes: {},
  rateLimitMax: 1000,
  rateLimitWindowMs: 60000,
  auditLogPath: null,
  playwrightMcpExecutionEnabled: false,
  playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
  playwrightMcpTimeoutMs: 5000,
  reaLocalHandoffEnabled: true,
  reaWorkspaceRoots: [REA_TEST_WORKSPACE],
  reaAllowlistProfile: "v2"
});

describe("REA routing profile v2", () => {
  it("v1 profile rejects v2-only tool hints", async () => {
    const v1 = { ...v2Config, reaAllowlistProfile: "v1" as const };
    const service = new DecisionService(v1, mockProvider("trace_web_module_imports", 0.99));
    const result = await routeReaLocalHandoff({
      config: v1,
      decisionService: service,
      request: {
        project: "agent-core",
        task: "trace imports",
        tool_hint: "trace_web_module_imports",
        tool_arguments: { manifest_path: manifestPath, script_index: 0 },
        rea_mcp_connected: true
      }
    });
    expect(result.disposition).toBe("DENY");
    expect(result.reason).toBe("TOOL_NOT_ALLOWLISTED");
  });

  it("v2 workspace manifest path validates and side-effect review applies", async () => {
    const service = new DecisionService(v2Config, mockProvider("trace_web_module_imports", 0.95));
    const result = await routeReaLocalHandoff({
      config: v2Config,
      decisionService: service,
      request: {
        project: "agent-core",
        task: "Trace module imports from export manifest",
        tool_arguments: { manifest_path: manifestPath, script_index: 0 },
        rea_mcp_connected: true
      }
    });
    expect(result.disposition).toBe("HUMAN_REVIEW");
    expect(result.reason).toBe("REA_TOOL_SIDE_EFFECT_REVIEW");
    expect(result.selected_tool).toBe("trace_web_module_imports");
  });

  it("v2 source map trace requires workspace-bounded map path", async () => {
    const service = new DecisionService(v2Config, mockProvider("trace_web_source_location", 0.95));
    const result = await routeReaLocalHandoff({
      config: v2Config,
      decisionService: service,
      request: {
        project: "agent-core",
        task: "Trace source map position",
        tool_arguments: {
          manifest_path: manifestPath,
          script_index: 0,
          source_map: { path: sourceMapPath, url: "https://example.test/app.js.map" },
          generated_position: { line: 1, column: 0 }
        },
        rea_mcp_connected: true
      }
    });
    expect(result.disposition).toBe("HUMAN_REVIEW");
    expect(result.selected_tool).toBe("trace_web_source_location");
  });

  it("v2 still allows READ-only binary_session handoff", async () => {
    const service = new DecisionService(v2Config, mockProvider("binary_session", 0.99));
    const result = await routeReaLocalHandoff({
      config: v2Config,
      decisionService: service,
      request: {
        project: "agent-core",
        task: "REA session metadata",
        tool_arguments: {},
        rea_mcp_connected: true
      }
    });
    expect(result.disposition).toBe("ALLOW_HANDOFF");
    expect(result.handoff?.tool).toBe("binary_session");
  });

  it("v1 synthetic javascript path unchanged", async () => {
    const v1 = { ...v2Config, reaAllowlistProfile: "v1" as const };
    const service = new DecisionService(v1, mockProvider("analyze_javascript_application", 0.95));
    const result = await routeReaLocalHandoff({
      config: v1,
      decisionService: service,
      request: {
        project: "agent-core",
        task: "Analyze synthetic javascript",
        tool_arguments: { input_path: REA_SYNTHETIC_APP, format: "directory" },
        rea_mcp_connected: true
      }
    });
    expect(result.disposition).toBe("ALLOW_HANDOFF");
  });
});
