import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RuntimeConfig } from "../../src/config.js";

export function testRuntimeConfig(config: RuntimeConfig): RuntimeConfig {
  return {
    reaLocalHandoffEnabled: false,
    reaWorkspaceRoots: [],
    reaPackageVersion: "6.4.0",
    reaAllowlistProfile: "v1",
    ...config
  };
}

const testsDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
export const REA_TEST_WORKSPACE = resolve(testsDir, "fixtures", "rea-workspace");
export const REA_SYNTHETIC_APP = resolve(REA_TEST_WORKSPACE, "inbox", "synthetic-app");
