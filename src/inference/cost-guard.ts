import { groqRuntimeDefaults, type RuntimeConfig } from "../config.js";
import type { ChatCompletionUsage } from "../providers/openai-chat.js";
import {
  atomicWriteLedger,
  emptyCostLedger,
  InferenceLedgerCorruptError,
  readLedgerFile
} from "./ledger-io.js";
import { withLedgerFileLock } from "./ledger-lock.js";

export type CostLedger = {
  month: string;
  spent_usd: number;
  reserved_usd: number;
  requests: number;
  tokens: { prompt: number; completion: number; total: number };
};

export { InferenceLedgerCorruptError };

export class InferenceBudgetExceededError extends Error {
  constructor(
    message: string,
    public readonly ledger: CostLedger,
    public readonly budgetUsd: number
  ) {
    super(message);
    this.name = "InferenceBudgetExceededError";
  }
}

function currentMonthKey(now = new Date()): string {
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

export class InferenceCostGuard {
  private readonly groq: ReturnType<typeof groqRuntimeDefaults>;
  private processLock: Promise<void> = Promise.resolve();

  constructor(private readonly config: RuntimeConfig) {
    this.groq = groqRuntimeDefaults(config);
  }

  assertLedgerConfigured(): void {
    const keysActive = Boolean(this.config.groqApiKey || this.config.openRouterApiKey);
    if (!keysActive) return;
    if (this.config.env === "test") return;
    if (!this.groq.groqCostLedgerPath) {
      throw new Error("GROQ_COST_LEDGER must be configured when inference keys are active");
    }
  }

  private lockTimeoutMs(): number {
    return this.config.groqLedgerLockTimeoutMs ?? 5000;
  }

  private staleLockMs(): number {
    return this.config.groqLedgerStaleLockMs ?? 120_000;
  }

  private async withProcessLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.processLock.then(fn, fn);
    this.processLock = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private ledgerPath(): string | null {
    return this.groq.groqCostLedgerPath;
  }

  private async loadLedgerForMutation(now: Date): Promise<CostLedger> {
    const path = this.ledgerPath();
    const month = currentMonthKey(now);
    if (!path) return emptyCostLedger(month);

    const { ledger } = await readLedgerFile(path, {
      expectedMonth: month,
      allowInitialize: true
    });
    return ledger;
  }

  private async persistLedger(ledger: CostLedger): Promise<void> {
    const path = this.ledgerPath();
    if (!path) return;
    await atomicWriteLedger(path, ledger);
  }

  private async mutateLedger<T>(
    mutate: (ledger: CostLedger) => { ledger: CostLedger; result: T },
    now = new Date()
  ): Promise<T> {
    this.assertLedgerConfigured();
    const path = this.ledgerPath();
    return this.withProcessLock(async () =>
      withLedgerFileLock(
        path,
        this.lockTimeoutMs(),
        async () => {
          const ledger = await this.loadLedgerForMutation(now);
          const { ledger: next, result } = mutate(ledger);
          await this.persistLedger(next);
          return result;
        },
        this.staleLockMs()
      )
    );
  }

  async readLedger(now = new Date()): Promise<CostLedger> {
    const month = currentMonthKey(now);
    const path = this.ledgerPath();
    if (!path) return emptyCostLedger(month);

    const { ledger } = await readLedgerFile(path, {
      expectedMonth: month,
      allowInitialize: true
    });
    return ledger;
  }

  private projectedSpend(ledger: CostLedger): number {
    return ledger.spent_usd + ledger.reserved_usd;
  }

  async reserveBudget(reserveUsd: number, now = new Date()): Promise<void> {
    if (reserveUsd <= 0) return;
    await this.mutateLedger((ledger) => {
      const projected = this.projectedSpend(ledger) + reserveUsd;
      if (projected > this.groq.groqMonthlyBudgetUsd) {
        throw new InferenceBudgetExceededError(
          "Groq inference monthly budget would be exceeded",
          ledger,
          this.groq.groqMonthlyBudgetUsd
        );
      }
      return {
        ledger: {
          ...ledger,
          reserved_usd: Number((ledger.reserved_usd + reserveUsd).toFixed(8))
        },
        result: undefined
      };
    }, now);
  }

  async settleReservation(
    reserveUsd: number,
    actualUsd: number,
    usage: ChatCompletionUsage,
    now = new Date()
  ): Promise<CostLedger> {
    if (!Number.isFinite(actualUsd) || actualUsd < 0) {
      throw new InferenceLedgerCorruptError("Cannot settle reservation with invalid cost");
    }
    return this.mutateLedger((ledger) => {
      const reserved = Math.max(0, ledger.reserved_usd - reserveUsd);
      const next: CostLedger = {
        month: ledger.month,
        spent_usd: Number((ledger.spent_usd + actualUsd).toFixed(8)),
        reserved_usd: Number(reserved.toFixed(8)),
        requests: ledger.requests + 1,
        tokens: {
          prompt: ledger.tokens.prompt + usage.prompt_tokens,
          completion: ledger.tokens.completion + usage.completion_tokens,
          total: ledger.tokens.total + usage.total_tokens
        }
      };
      return { ledger: next, result: next };
    }, now);
  }

  async releaseReservation(reserveUsd: number, now = new Date()): Promise<void> {
    if (reserveUsd <= 0) return;
    await this.mutateLedger((ledger) => ({
      ledger: {
        ...ledger,
        reserved_usd: Number(Math.max(0, ledger.reserved_usd - reserveUsd).toFixed(8))
      },
      result: undefined
    }), now);
  }

  budgetRemainingUsd(ledger: CostLedger): number {
    return Number(
      Math.max(0, this.groq.groqMonthlyBudgetUsd - this.projectedSpend(ledger)).toFixed(6)
    );
  }
}
