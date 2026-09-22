import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export type AuditEvent = {
  timestamp: string; project: string; route: string; action: string; result: string;
  task_id?: string; decision_type?: string; confidence?: number; fallback?: boolean;
  latency_ms?: number; provider_request_id?: string | null;
};

export class Metrics {
  private counters = new Map<string, number>();
  private latencies: number[] = [];
  increment(name: string, value = 1) { this.counters.set(name, (this.counters.get(name) ?? 0) + value); }
  observeLatency(ms: number) { this.latencies.push(ms); if (this.latencies.length > 1000) this.latencies.shift(); }
  snapshot() {
    const sorted = [...this.latencies].sort((a,b)=>a-b);
    const p95 = sorted.length ? sorted[Math.min(sorted.length-1, Math.floor(sorted.length*0.95))] : 0;
    return { counters: Object.fromEntries(this.counters), latency_ms: { count: sorted.length, p95 } };
  }
}

export class AuditLogger {
  constructor(private readonly filePath: string | null) {}
  async write(event: AuditEvent) {
    if (!this.filePath) return;
    await mkdir(dirname(this.filePath), { recursive: true });
    await appendFile(this.filePath, JSON.stringify(event) + "\n", "utf8");
  }
}