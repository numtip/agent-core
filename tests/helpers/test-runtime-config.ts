import type { RuntimeConfig } from "../../src/config.js";

export function testRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  return {
    reaLocalHandoffEnabled: false,
    reaWorkspaceRoots: [],
    reaPackageVersion: "6.4.0",
    ...config
  };
}

export const REA_TEST_WORKSPACE = "F:\\projectAi\\REA";
export const REA_SYNTHETIC_APP = "F:\\projectAi\\REA\\inbox\\synthetic-app";
