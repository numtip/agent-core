import { InferenceCostGuard } from "../../src/inference/cost-guard.js";
import { testRuntimeConfig } from "../helpers/test-runtime-config.js";

const ledgerPath = process.env.LEDGER_PATH;
const reserveUsd = Number(process.env.RESERVE_USD ?? "0");
const budgetUsd = Number(process.env.BUDGET_USD ?? "10");

if (!ledgerPath || !Number.isFinite(reserveUsd) || reserveUsd <= 0) {
  process.exit(2);
}

const guard = new InferenceCostGuard(
  testRuntimeConfig({
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
    groqLedgerStaleLockMs: 1000
  })
);

try {
  await guard.reserveBudget(reserveUsd);
  process.stdout.write("OK");
  process.exit(0);
} catch {
  process.stdout.write("DENY");
  process.exit(1);
}
