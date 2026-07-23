import { describe, it, expect } from 'vitest';
import { DETAIL_TARGET_TRIANGLE_COUNTS } from './detail';

describe('DETAIL_TARGET_TRIANGLE_COUNTS', () => {
  it('maps every DetailLevel to its spec-defined target triangle count', () => {
    expect(DETAIL_TARGET_TRIANGLE_COUNTS).toEqual({
      low: 20_000,
      med: 80_000,
      high: 200_000,
      max: 500_000,
    });
  });

  it('is monotonically increasing low -> med -> high -> max', () => {
    const { low, med, high, max } = DETAIL_TARGET_TRIANGLE_COUNTS;
    expect(low).toBeLessThan(med);
    expect(med).toBeLessThan(high);
    expect(high).toBeLessThan(max);
  });

  it('max matches the Q-01-resolved clamp (500,000), not a provisional placeholder', () => {
    expect(DETAIL_TARGET_TRIANGLE_COUNTS.max).toBe(500_000);
  });
});

// createWorkerRemeshRunner (the real Web Worker dispatch) is not covered
// here: `Worker` doesn't exist in this project's Node-based Vitest
// environment (no DOM test environment is configured), so there is no
// way to unit-test actual worker dispatch. See its doc comment in
// detail.ts and the corresponding note in the sculpt-engine-core plan's
// Decisions & Notes log — SculptEngine's injectable RemeshRunner exists
// so everything else around it can still be fully unit-tested.
