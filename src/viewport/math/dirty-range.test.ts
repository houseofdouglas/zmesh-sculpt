import { describe, it, expect } from 'vitest';
import { vertexRangeToAttributeRange } from './dirty-range';

describe('vertexRangeToAttributeRange', () => {
  it('converts a multi-vertex half-open range to the correct xyz element offset/count', () => {
    expect(vertexRangeToAttributeRange(2, 5)).toEqual({ offset: 6, count: 9 });
  });

  it('converts a single-vertex range', () => {
    expect(vertexRangeToAttributeRange(0, 1)).toEqual({ offset: 0, count: 3 });
  });

  it('converts a zero-width range to zero count at the right offset', () => {
    expect(vertexRangeToAttributeRange(5, 5)).toEqual({ offset: 15, count: 0 });
  });

  it('converts a range starting away from zero', () => {
    expect(vertexRangeToAttributeRange(100, 110)).toEqual({ offset: 300, count: 30 });
  });
});
