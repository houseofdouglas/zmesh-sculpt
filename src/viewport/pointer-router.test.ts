import { describe, it, expect } from 'vitest';
import {
  classifyMode,
  classifyPointerDownGesture,
  classifyWheelGesture,
  type GestureKind,
} from './pointer-router';

describe('classifyMode', () => {
  const gestures: GestureKind[] = ['primary-drag', 'secondary-drag', 'pan-drag', 'zoom'];

  it('is sculpt only for primary-drag + hitMesh=true — full truth table otherwise camera', () => {
    for (const gesture of gestures) {
      for (const hitMesh of [true, false]) {
        const expected = gesture === 'primary-drag' && hitMesh ? 'sculpt' : 'camera';
        expect(classifyMode(gesture, hitMesh)).toBe(expected);
      }
    }
  });

  it('never sculpts for secondary-drag even over the mesh (FR-15: always orbit)', () => {
    expect(classifyMode('secondary-drag', true)).toBe('camera');
  });

  it('never sculpts for pan-drag or zoom regardless of hitMesh', () => {
    expect(classifyMode('pan-drag', true)).toBe('camera');
    expect(classifyMode('pan-drag', false)).toBe('camera');
    expect(classifyMode('zoom', true)).toBe('camera');
    expect(classifyMode('zoom', false)).toBe('camera');
  });
});

describe('classifyPointerDownGesture', () => {
  it('treats the primary button as a primary-drag, regardless of Shift', () => {
    expect(classifyPointerDownGesture({ button: 0, shiftKey: false })).toBe('primary-drag');
    expect(classifyPointerDownGesture({ button: 0, shiftKey: true })).toBe('primary-drag');
  });

  it('treats the middle button as a pan-drag, regardless of Shift', () => {
    expect(classifyPointerDownGesture({ button: 1, shiftKey: false })).toBe('pan-drag');
    expect(classifyPointerDownGesture({ button: 1, shiftKey: true })).toBe('pan-drag');
  });

  it('treats a plain right-drag as secondary-drag (orbit)', () => {
    expect(classifyPointerDownGesture({ button: 2, shiftKey: false })).toBe('secondary-drag');
  });

  it('treats Shift+right-drag as a pan-drag', () => {
    expect(classifyPointerDownGesture({ button: 2, shiftKey: true })).toBe('pan-drag');
  });

  it('falls back to primary-drag for an unrecognized button', () => {
    expect(classifyPointerDownGesture({ button: 3, shiftKey: false })).toBe('primary-drag');
  });
});

describe('classifyWheelGesture', () => {
  it('treats ctrlKey as zoom, taking precedence over shiftKey', () => {
    expect(classifyWheelGesture({ ctrlKey: true, shiftKey: false })).toBe('zoom');
    expect(classifyWheelGesture({ ctrlKey: true, shiftKey: true })).toBe('zoom');
  });

  it('treats shiftKey (without ctrlKey) as pan', () => {
    expect(classifyWheelGesture({ ctrlKey: false, shiftKey: true })).toBe('pan');
  });

  it('treats an unmodified wheel event as orbit', () => {
    expect(classifyWheelGesture({ ctrlKey: false, shiftKey: false })).toBe('orbit');
  });
});
