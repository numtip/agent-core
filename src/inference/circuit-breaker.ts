import type { InferenceProviderId } from "./routing.js";

type BreakerEntry = { failures: number; openUntil: number };

/**
 * Per-provider circuit breaker: after `threshold` consecutive failures the provider is
 * skipped for `cooldownMs`, then allowed one trial call.
 * shortcut: in-process state only (per instance); upgrade to a shared store before multi-instance use.
 */
export class InferenceCircuitBreaker {
  private readonly entries = new Map<InferenceProviderId, BreakerEntry>();

  constructor(
    private readonly threshold: number,
    private readonly cooldownMs: number,
    private readonly now: () => number = () => Date.now()
  ) {}

  allow(provider: InferenceProviderId): boolean {
    const entry = this.entries.get(provider);
    return !entry || entry.openUntil <= this.now();
  }

  recordSuccess(provider: InferenceProviderId): void {
    this.entries.delete(provider);
  }

  recordFailure(provider: InferenceProviderId): void {
    const entry = this.entries.get(provider) ?? { failures: 0, openUntil: 0 };
    const failures = entry.failures + 1;
    const openUntil =
      failures >= Math.max(1, this.threshold) ? this.now() + this.cooldownMs : 0;
    this.entries.set(provider, { failures, openUntil });
  }

  snapshot(): Record<string, { failures: number; open: boolean }> {
    const out: Record<string, { failures: number; open: boolean }> = {};
    for (const [provider, entry] of this.entries) {
      out[provider] = { failures: entry.failures, open: entry.openUntil > this.now() };
    }
    return out;
  }
}
