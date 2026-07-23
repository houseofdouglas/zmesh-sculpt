import type { BrushKernel } from './brush-kernel';
import { applyDraw } from './draw';
import { applySmooth } from './smooth';
import { applyInflate } from './inflate';
import { applyPinch } from './pinch';
import { applyCrease } from './crease';
import { applyFlatten } from './flatten';

/**
 * The six brushes that are pure per-stamp kernels (BrushKernelContext in,
 * mutated positions out). Grab is deliberately excluded — it's
 * stroke-stateful (fixes an affected set on beginStroke, translates it
 * each update until endStroke), not a stamp kernel, and is implemented in
 * the engine's stroke lifecycle (Task 12) rather than here.
 */
export type StampBrushType = 'draw' | 'smooth' | 'inflate' | 'pinch' | 'crease' | 'flatten';

export const STAMP_BRUSH_KERNELS: Readonly<Record<StampBrushType, BrushKernel>> = {
  draw: applyDraw,
  smooth: applySmooth,
  inflate: applyInflate,
  pinch: applyPinch,
  crease: applyCrease,
  flatten: applyFlatten,
};

export { applyDraw, applySmooth, applyInflate, applyPinch, applyCrease, applyFlatten };
export { computeFalloff } from './falloff';
export type { BrushKernel, BrushKernelContext, Stamp } from './brush-kernel';
