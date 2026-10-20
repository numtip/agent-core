import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, stat, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  InferenceCostGuard,
  InferenceLedgerCorruptError
} from "../src/inference/cost-guard.js";
import { readLedgerFile } from "../src/inference/ledger-io.js";
import { acquireLedgerFileLock } from "../src/inference/ledger-lock.js";
import { InferenceService } from "../src/services/inference.js";
import { testRuntimeConfig } from "./helpers/test-runtime-config.js";

const execFileAsync = promisify(execFile);
const workerPath = fileURLToPath(new URL("./fixtures/ledger-reserve-worker.ts", import.meta.url));

function ledgerConfig(ledgerPath: string, budgetUsd = 0.002) {
  return testRuntimeConfig({
    env: "development",
    host: "127.0.0.1",
    port: 8787,
    openRouterDecisionsUrl: "https://example.invalid",
    jevModel: "~typesafe/jev-latest",
    requestTimeoutMs: 1000,
    confidenceExecute: 0.85,
    confidenceReview: 0.6,
    authRequired: false,
    projectKeys: {},
    projectScopes: {},
    rateLimitMax: 100,
    rateLimitWindowMs: 60000,
    auditLogPath: null,
    playwrightMcpExecutionEnabled: false,
    playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
    playwrightMcpTimeoutMs: 5000,
    groqApiKey: "gsk-test",
    groqMonthlyBudgetUsd: budgetUsd,
    groqCostLedgerPath: ledgerPath,
    groqUsdPer1MInputTokens: 1,
    groqUsdPer1MOutputTokens: 1,
    groqLedgerLockTimeoutMs: 8000,
    groqLedgerStaleLockMs: 500
  });
}

describe("ledger budget safety", () => {
  it("fail-closed on corrupt ledger JSON", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-corrupt-"));
    const ledgerPath = join(dir, "ledger.json");
    await writeFile(ledgerPath, "{not-json", "utf8");
    const guard = new InferenceCostGuard(ledgerConfig(ledgerPath));
    await expect(guard.readLedger()).rejects.toBeInstanceOf(InferenceLedgerCorruptError);
  });

  it("archives prior month instead of silently resetting spend", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-rollover-"));
    const ledgerPath = join(dir, "ledger.json");
    await writeFile(
      ledgerPath,
      JSON.stringify({
        month: "2020-01",
        spent_usd: 3.5,
        reserved_usd: 0,
        requests: 9,
        tokens: { prompt: 1, completion: 1, total: 2 }
      }),
      "utf8"
    );

    const month = new Date().toISOString().slice(0, 7);
    const { ledger, archivedPath } = await readLedgerFile(ledgerPath, {
      expectedMonth: month,
      allowInitialize: true
    });

    expect(archivedPath).toBeDefined();
    expect(String(archivedPath)).toContain("2020-01");
    expect(ledger.month).toBe(month);
    expect(ledger.spent_usd).toBe(0);
    const archived = JSON.parse(await readFile(archivedPath!, "utf8"));
    expect(archived.spent_usd).toBe(3.5);
  });

  it("reclaims stale lock files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-lock-"));
    const ledgerPath = join(dir, "ledger.json");
    const lockPath = `${ledgerPath}.lock`;
    await writeFile(lockPath, "", "utf8");
    const old = Date.now() - 60_000;
    await utimes(lockPath, old / 1000, old / 1000);

    const release = await acquireLedgerFileLock(ledgerPath, 2000, 1000);
    await release();
  });

  it("cross-process reservations cannot overshoot shared budget", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-mp-"));
    const ledgerPath = join(dir, "ledger.json");
    const month = new Date().toISOString().slice(0, 7);
    await writeFile(
      ledgerPath,
      JSON.stringify({
        month,
        spent_usd: 0,
        reserved_usd: 0,
        requests: 0,
        tokens: { prompt: 0, completion: 0, total: 0 }
      }),
      "utf8"
    );

    const env = {
      ...process.env,
      LEDGER_PATH: ledgerPath,
      RESERVE_USD: "0.0015",
      BUDGET_USD: "0.002"
    };

    const runWorker = async () => {
      try {
        const tsxCli = fileURLToPath(
          new URL("../node_modules/tsx/dist/cli.mjs", import.meta.url)
        );
        const { stdout } = (await execFileAsync(process.execPath, [tsxCli, workerPath], {
          env,
          timeout: 30_000,
          maxBuffer: 1024 * 1024
        })) as { stdout: string; stderr: string };
        return String(stdout);
      } catch (error) {
        const stdout =
          error && typeof error === "object" && "stdout" in error
            ? String((error as { stdout?: Buffer | string }).stdout ?? "")
            : "";
        return stdout;
      }
    };

    const first = await runWorker();
    const second = await runWorker();
    expect(first).toContain("OK");
    expect(second).toContain("DENY");

    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    expect(ledger.reserved_usd).toBeCloseTo(0.0015, 6);
  });

  it("fallback OpenRouter spend uses shared budget with provider-specific pricing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ledger-fallback-"));
    const ledgerPath = join(dir, "ledger.json");
    const config = testRuntimeConfig({
      ...ledgerConfig(ledgerPath, 10),
      openRouterApiKey: "or-key",
      groqFallbackOpenRouter: true,
      groqUsdPer1MInputTokens: 0.1,
      groqUsdPer1MOutputTokens: 0.1,
      openRouterUsdPer1MInputTokens: 0.9,
      openRouterUsdPer1MOutputTokens: 0.9
    });

    const inference = new InferenceService(config, {
      fetchImpl: async (input) => {
        const url = String(input);
        if (url.includes("groq.example")) {
          return new Response("fail", { status: 503 });
        }
        return new Response(
          JSON.stringify({
            choices: [{ message: { content: "FB" } }],
            usage: { prompt_tokens: 1_000_000, completion_tokens: 0, total_tokens: 1_000_000 }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
    });

    const result = await inference.complete({
      project: "agent-core",
      messages: [{ role: "user", content: "test" }]
    });
    expect(result.provider).toBe("openrouter");
    expect(result.pricing_provider).toBe("openrouter");
    expect(result.estimated_cost_usd).toBe(0.9);

    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    expect(ledger.spent_usd).toBe(0.9);
    expect(ledger.requests).toBe(1);
  });

  it("rejects ambiguous provider usage instead of billing", async () => {
    const config = testRuntimeConfig({
      env: "test",
      host: "127.0.0.1",
      port: 8787,
      openRouterDecisionsUrl: "https://example.invalid",
      jevModel: "~typesafe/jev-latest",
      requestTimeoutMs: 1000,
      confidenceExecute: 0.85,
      confidenceReview: 0.6,
      authRequired: false,
      projectKeys: {},
      projectScopes: {},
      rateLimitMax: 100,
      rateLimitWindowMs: 60000,
      auditLogPath: null,
      playwrightMcpExecutionEnabled: false,
      playwrightMcpEndpoint: "http://127.0.0.1:8791/mcp",
      playwrightMcpTimeoutMs: 5000,
      groqEnabled: true,
      groqApiKey: "gsk-test",
      groqCostLedgerPath: null,
      groqFallbackOpenRouter: false
    });
    const inference = new InferenceService(config, {
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            choices: [{ message: { content: "X" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 3 }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
    });
    await expect(
      inference.complete({
        project: "agent-core",
        messages: [{ role: "user", content: "x" }]
      })
    ).rejects.toThrow(/total_tokens is less than sum/i);
  });
});
