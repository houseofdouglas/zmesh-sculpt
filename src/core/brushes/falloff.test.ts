import { describe, it, expect } from 'vitest';
import { computeFalloff } from './falloff';

describe('computeFalloff', () => {
  it('is 1 at the stamp center (distance 0)', () => {
    expect(computeFalloff(0, 10)).toBe(1);
  });

  it('is 0 at the radius edge', () => {
    expect(computeFalloff(10, 10)).toBe(0);
  });

  it('is 0 beyond the radius', () => {
    expect(computeFalloff(15, 10)).toBe(0);
  });

  it('decreases monotonically from center to edge', () => {
    const radius = 10;
    let previous = computeFalloff(0, radius);
    for (let d = 1; d <= radius; d++) {
      const current = computeFalloff(d, radius);
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  it('is 0 for a non-positive radius', () => {
    expect(computeFalloff(0, 0)).toBe(0);
    expect(computeFalloff(5, -1)).toBe(0);
  });
});
