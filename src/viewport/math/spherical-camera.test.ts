import { describe, it, expect } from 'vitest';
import { framingDistance, sphericalToPosition } from './spherical-camera';
import { length, subtract, type Vec3 } from './vec3';

const FOV_50_DEG = (50 * Math.PI) / 180;

describe('framingDistance', () => {
  it('returns a distance at which the bounds diagonal fits within the vertical FOV', () => {
    const boundsDiagonalMm = 50;
    const distance = framingDistance(boundsDiagonalMm, FOV_50_DEG);
    const viewHeightAtDistance = 2 * distance * Math.tan(FOV_50_DEG / 2);
    expect(viewHeightAtDistance).toBeGreaterThanOrEqual(boundsDiagonalMm);
  });

  it('scales up for a larger bounds diagonal (same FOV)', () => {
    const small = framingDistance(50, FOV_50_DEG);
    const large = framingDistance(200, FOV_50_DEG);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeCloseTo(small * 4, 6); // linear in bounds diagonal
  });

  it('shrinks for a wider FOV (same bounds)', () => {
    const narrowFov = framingDistance(50, (30 * Math.PI) / 180);
    const wideFov = framingDistance(50, (90 * Math.PI) / 180);
    expect(wideFov).toBeLessThan(narrowFov);
  });

  it('is always positive for a positive diagonal and a valid FOV', () => {
    expect(framingDistance(1, FOV_50_DEG)).toBeGreaterThan(0);
  });
});

describe('sphericalToPosition', () => {
  const target: Vec3 = [0, 0, 0];
  const radius = 10;

  it('places yaw=0, pitch=0 on the +Z side of the target, at the target height', () => {
    const pos = sphericalToPosition(target, radius, 0, 0);
    expect(pos[0]).toBeCloseTo(0, 10);
    expect(pos[1]).toBeCloseTo(0, 10);
    expect(pos[2]).toBeCloseTo(radius, 10);
  });

  it('places pitch=pi/2 directly above the target', () => {
    const pos = sphericalToPosition(target, radius, 0, Math.PI / 2);
    expect(pos[0]).toBeCloseTo(0, 10);
    expect(pos[1]).toBeCloseTo(radius, 10);
    expect(pos[2]).toBeCloseTo(0, 10);
  });

  it('rotates around Y as yaw increases', () => {
    const pos = sphericalToPosition(target, radius, Math.PI / 2, 0);
    expect(pos[0]).toBeCloseTo(radius, 10);
    expect(pos[1]).toBeCloseTo(0, 10);
    expect(pos[2]).toBeCloseTo(0, 10);
  });

  it('offsets from a non-origin target', () => {
    const offCenterTarget: Vec3 = [5, 2, -3];
    const pos = sphericalToPosition(offCenterTarget, radius, 0, 0);
    expect(pos[0]).toBeCloseTo(5, 10);
    expect(pos[1]).toBeCloseTo(2, 10);
    expect(pos[2]).toBeCloseTo(-3 + radius, 10);
  });

  it('stays exactly `radius` away from the target for any yaw/pitch', () => {
    const angles = [
      [0, 0],
      [1.2, 0.5],
      [-2.1, -0.7],
      [Math.PI, Math.PI / 3],
      [0.3, -Math.PI / 2 + 0.01],
    ];
    for (const [yaw, pitch] of angles) {
      const pos = sphericalToPosition(target, radius, yaw!, pitch!);
      expect(length(subtract(pos, target))).toBeCloseTo(radius, 10);
    }
  });
});
