import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { withLedgerFileLock } from "./ledger-lock.js";
import type { InferenceProviderId } from "./routing.js";

type BreakerEntry = { failures: number; open_until: number };
type BreakerState = Partial<Record<InferenceProviderId, BreakerEntry>>;

export type BreakerOptions = {
  /** Shared state file. When null the breaker is process-local only. */
  statePath?: string | null;
  lockTimeoutMs?: number;
  now?: () => number;
};

/** Breaker state lives next to the cost ledger so every process on the host shares it. */
export function breakerStatePathFor(ledgerPath: string | null | undefined): string | null {
  if (!ledgerPath) return null;
  return `${ledgerPath.replace(/\.json$/, "")}-breakers.json`;
}

function sanitise(raw: unknown): BreakerState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: BreakerState = {};
  for (const [provider, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== "object") continue;
    const failures = (entry as { failures?: unknown }).failures;
    const openUntil = (entry as { open_until?: unknown }).open_until;
    if (typeof failures !== "number" || !Number.isFinite(failures) || failures < 0) continue;
    if (typeof openUntil !== "number" || !Number.isFinite(openUntil)) continue;
    out[provider as InferenceProviderId] = { failures, open_until: openUntil };
  }
  return out;
}

/**
 * Per-provider circuit breaker: after `threshold` consecutive failures the provider is
 * skipped for `cooldownMs`, then allowed one trial call.
 * With a state path the state is shared through a locked file, so separate processes on the
 * same host see the same breakers. A missing or unreadable state file means "all closed".
 */
export class InferenceCircuitBreaker {
  private memory: BreakerState = {};
  private readonly statePath: string | null;
  private readonly lockTimeoutMs: number;
  private readonly now: () => number;

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    options: BreakerOptions = {}
  ) {
    this.statePath = options.statePath ?? null;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5000;
    this.now = options.now ?? (() => Date.now());
  }

  private async read(): Promise<BreakerState> {
    if (!this.statePath) return this.memory;
    try {
      return sanitise(JSON.parse(await readFile(this.statePath, "utf8")));
    } catch {
      return {};
    }
  }

  private async write(state: BreakerState): Promise<void> {
    if (!this.statePath) {
      this.memory = state;
      return;
    }
    await mkdir(dirname(this.statePath), { recursive: true });
    const tmp = `${this.statePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(tmp, this.statePath);
  }

  /** Locked read-modify-write so concurrent processes cannot lose failures. */
  private async mutate(apply: (state: BreakerState) => void): Promise<void> {
    if (!this.statePath) {
      apply(this.memory);
      return;
    }
    await withLedgerFileLock(this.statePath, this.lockTimeoutMs, async () => {
      const state = await this.read();
      apply(state);
      await this.write(state);
    });
  }

  async allow(provider: InferenceProviderId): Promise<boolean> {
    const entry = (await this.read())[provider];
    return !entry || entry.open_until <= this.now();
  }

  async recordSuccess(provider: InferenceProviderId): Promise<void> {
    await this.mutate((state) => {
      delete state[provider];
    });
  }

  async recordFailure(provider: InferenceProviderId): Promise<void> {
    await this.mutate((state) => {
      const failures = (state[provider]?.failures ?? 0) + 1;
      state[provider] = {
        failures,
        open_until: failures >= Math.max(1, this.threshold) ? this.now() + this.cooldownMs : 0
      };
    });
  }

  async snapshot(): Promise<Record<string, { failures: number; open: boolean }>> {
    const out: Record<string, { failures: number; open: boolean }> = {};
    for (const [provider, entry] of Object.entries(await this.read())) {
      out[provider] = { failures: entry.failures, open: entry.open_until > this.now() };
    }
    return out;
  }
}
