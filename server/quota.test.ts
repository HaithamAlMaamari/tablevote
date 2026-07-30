import { describe, expect, it } from 'vitest';
import { FixedWindowQuota } from './quota';

describe('fixed-window quota', () => {
  it('enforces a key limit and resets after the window', () => {
    const quota = new FixedWindowQuota(1_000, 2);
    expect(quota.allow('a', 2, 0)).toBe(true);
    expect(quota.allow('a', 2, 1)).toBe(true);
    expect(quota.allow('a', 2, 2)).toBe(false);
    expect(quota.allow('b', 2, 3)).toBe(true);
    expect(quota.allow('untracked-attacker', 2, 4)).toBe(false);
    expect(quota.size).toBe(2);

    expect(quota.allow('untracked-attacker', 2, 1_004)).toBe(true);
    expect(quota.size).toBe(1);
  });

  it('bounds distributed session keys instead of evicting active counters', () => {
    const quota = new FixedWindowQuota(10_000, 3);
    for (const sessionId of ['one', 'two', 'three']) {
      expect(quota.allow(sessionId, 1, 0)).toBe(true);
    }
    expect(quota.allow('four', 1, 0)).toBe(false);
    expect(quota.allow('one', 1, 0)).toBe(false);
    expect(quota.size).toBe(3);
  });
});
