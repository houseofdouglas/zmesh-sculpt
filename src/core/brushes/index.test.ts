import { describe, it, expect } from 'vitest';
import { STAMP_BRUSH_KERNELS } from './index';
import type { StampBrushType } from './index';

describe('STAMP_BRUSH_KERNELS registry', () => {
  it('resolves every stamp brush type to a callable kernel', () => {
    const types: StampBrushType[] = ['draw', 'smooth', 'inflate', 'pinch', 'crease', 'flatten'];
    for (const type of types) {
      expect(typeof STAMP_BRUSH_KERNELS[type]).toBe('function');
    }
  });

  it('has exactly the 6 stamp brush types — no more, no less (Grab excluded, it is stroke-stateful)', () => {
    expect(Object.keys(STAMP_BRUSH_KERNELS).sort()).toEqual([
      'crease',
      'draw',
      'flatten',
      'inflate',
      'pinch',
      'smooth',
    ]);
  });
});
