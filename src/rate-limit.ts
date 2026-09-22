export class RateLimiter {
  private readonly buckets = new Map<string, { windowStart: number; count: number }>();
  constructor(private readonly maxRequests: number, private readonly windowMs: number) {}
  allow(key: string, now = Date.now()): boolean {
    const current = this.buckets.get(key);
    if (!current || now - current.windowStart >= this.windowMs) {
      this.buckets.set(key, { windowStart: now, count: 1 });
      return true;
    }
    if (current.count >= this.maxRequests) return false;
    current.count += 1;
    return true;
  }
}