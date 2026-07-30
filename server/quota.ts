export class FixedWindowQuota {
  private readonly entries = new Map<string, { count: number; resetsAt: number }>();

  constructor(
    private readonly windowMs: number,
    private readonly maxKeys: number,
  ) {}

  allow(key: string, maximum: number, now = Date.now()): boolean {
    const current = this.entries.get(key);
    if (current && current.resetsAt > now) {
      if (current.count >= maximum) return false;
      current.count += 1;
      return true;
    }
    if (current) this.entries.delete(key);
    if (this.entries.size >= this.maxKeys) this.sweep(now);
    if (this.entries.size >= this.maxKeys) return false;
    this.entries.set(key, { count: 1, resetsAt: now + this.windowMs });
    return true;
  }

  sweep(now = Date.now()): void {
    for (const [key, entry] of this.entries) {
      if (entry.resetsAt <= now) this.entries.delete(key);
    }
  }

  get size(): number {
    return this.entries.size;
  }
}
