/**
 * Smooth (Hermite) falloff: 1 at the stamp center, smoothly decreasing to
 * 0 at the radius edge, and 0 beyond it. Every brush kernel weights its
 * displacement by this so a stamp's effect fades out rather than cutting
 * off sharply at the brush radius.
 */
export function computeFalloff(distance: number, radius: number): number {
  if (radius <= 0) {
    return 0;
  }
  const t = 1 - distance / radius;
  if (t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  return t * t * (3 - 2 * t);
}
