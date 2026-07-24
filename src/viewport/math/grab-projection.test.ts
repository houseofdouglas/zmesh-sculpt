import { describe, it, expect } from 'vitest';
import { projectScreenDeltaToWorld } from './grab-projection';
import { dot, length, type Vec3 } from './vec3';

const FOV_50_DEG = (50 * Math.PI) / 180;
const VIEWPORT_HEIGHT_PX = 800;

describe('projectScreenDeltaToWorld', () => {
  const cameraPosition: Vec3 = [0, 0, 0];
  const cameraForward: Vec3 = [0, 0, -1];
  const cameraUp: Vec3 = [0, 1, 0];

  it('maps a rightward screen delta onto the camera-facing plane through the grab point', () => {
    const grabPoint: Vec3 = [0, 0, -10];
    const worldDelta = projectScreenDeltaToWorld(
      grabPoint,
      cameraPosition,
      cameraForward,
      cameraUp,
      5,
      0,
      VIEWPORT_HEIGHT_PX,
      FOV_50_DEG,
    );

    expect(worldDelta[0]).toBeGreaterThan(0); // moves along camera-right
    expect(worldDelta[1]).toBeCloseTo(0, 10);
    expect(worldDelta[2]).toBeCloseTo(0, 10);
    // Lies in the plane through grabPoint facing the camera: perpendicular to forward.
    expect(dot(worldDelta, cameraForward)).toBeCloseTo(0, 10);
  });

  it('maps a downward screen delta (positive screenDy) to a negative world-up component', () => {
    const grabPoint: Vec3 = [0, 0, -10];
    const worldDelta = projectScreenDeltaToWorld(
      grabPoint,
      cameraPosition,
      cameraForward,
      cameraUp,
      0,
      5,
      VIEWPORT_HEIGHT_PX,
      FOV_50_DEG,
    );

    expect(worldDelta[1]).toBeLessThan(0); // screen Y grows downward; world up is the opposite sense
  });

  it('scales magnitude linearly with depth for the same pixel delta (2x distance -> 2x world delta)', () => {
    const near = projectScreenDeltaToWorld(
      [0, 0, -10],
      cameraPosition,
      cameraForward,
      cameraUp,
      5,
      3,
      VIEWPORT_HEIGHT_PX,
      FOV_50_DEG,
    );
    const far = projectScreenDeltaToWorld(
      [0, 0, -20],
      cameraPosition,
      cameraForward,
      cameraUp,
      5,
      3,
      VIEWPORT_HEIGHT_PX,
      FOV_50_DEG,
    );

    expect(length(far)).toBeCloseTo(length(near) * 2, 6);
    // Direction is unchanged, only magnitude — a pure scale.
    expect(far[0]).toBeCloseTo(near[0] * 2, 6);
    expect(far[1]).toBeCloseTo(near[1] * 2, 6);
  });

  it('yields zero delta for zero screen motion', () => {
    const worldDelta = projectScreenDeltaToWorld(
      [0, 0, -10],
      cameraPosition,
      cameraForward,
      cameraUp,
      0,
      0,
      VIEWPORT_HEIGHT_PX,
      FOV_50_DEG,
    );
    expect(worldDelta[0]).toBeCloseTo(0, 10);
    expect(worldDelta[1]).toBeCloseTo(0, 10);
    expect(worldDelta[2]).toBeCloseTo(0, 10);
  });

  it('works for a differently-oriented camera (looking along +X)', () => {
    const forward: Vec3 = [1, 0, 0];
    const up: Vec3 = [0, 1, 0];
    const grabPoint: Vec3 = [10, 0, 0];

    const worldDelta = projectScreenDeltaToWorld(
      grabPoint,
      cameraPosition,
      forward,
      up,
      5,
      0,
      VIEWPORT_HEIGHT_PX,
      FOV_50_DEG,
    );

    expect(dot(worldDelta, forward)).toBeCloseTo(0, 10); // still perpendicular to the (new) forward
    expect(length(worldDelta)).toBeGreaterThan(0);
  });
});
