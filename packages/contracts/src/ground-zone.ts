import { z } from 'zod';

const normalized = z.number().min(0).max(1);
export const imagePoint = z.strictObject({ x: normalized, y: normalized });
const floorPoint = z.strictObject({ x: z.number(), y: z.number() });
const landmark = z.strictObject({ image: imagePoint, floor: floorPoint });
export const groundZone = z.strictObject({
  landmarks: z.tuple([landmark, landmark, landmark, landmark]),
  checks: z.array(landmark).min(1).max(32),
  maxErrorM: z.number().positive(),
  personToleranceM: z.number().nonnegative(),
  vehicleToleranceM: z.number().nonnegative(),
  points: z.array(floorPoint).min(3).max(32),
});
export type GroundZone = z.infer<typeof groundZone>;
type Point = z.infer<typeof floorPoint>;

export const groundDecision = z.object({
  state: z.enum(['inside', 'outside', 'unknown']),
  reason: z.enum(['ground-obscured', 'near-boundary', 'projection-unavailable', 'unsupported-object']).nullable(),
  method: z.enum(['ankles', 'wheel-line-proxy']).nullable(),
  points: z.array(z.object({ image: imagePoint, floor: floorPoint })),
});
export type GroundDecision = z.infer<typeof groundDecision>;

function fit(landmarks: GroundZone['landmarks'], from: 'image' | 'floor', to: 'image' | 'floor') {
  const origin = landmarks[0][from];
  const rows = landmarks.flatMap((mark) => {
    const x = mark[from].x - origin.x;
    const y = mark[from].y - origin.y;
    const { x: u, y: v } = mark[to];
    return [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]];
  });

  // Solve the eight homography coefficients with partial pivoting. At the
  // first landmark the homogeneous denominator is normalized to one.
  for (let column = 0; column < 8; column++) {
    let pivot = column;
    for (let row = column + 1; row < 8; row++) {
      if (Math.abs(rows[row]![column]!) > Math.abs(rows[pivot]![column]!)) pivot = row;
    }
    const divisor = rows[pivot]![column]!;
    if (!Number.isFinite(divisor) || Math.abs(divisor) < 1e-10) return;
    [rows[column], rows[pivot]] = [rows[pivot]!, rows[column]!];
    const normalized = rows[column]!.map((value) => value / divisor);
    rows[column] = normalized;
    for (let row = 0; row < 8; row++) {
      if (row === column) continue;
      const factor = rows[row]![column]!;
      rows[row] = rows[row]!.map((value, index) => value - factor * normalized[index]!);
    }
  }
  const [a, b, c, d, e, f, g, h] = rows.map((row) => row[8]!) as
    [number, number, number, number, number, number, number, number];
  return (point: Point): Point | undefined => {
    const x = point.x - origin.x;
    const y = point.y - origin.y;
    const w = g * x + h * y + 1;
    if (w <= 1e-8) return;
    const projected = { x: (a * x + b * y + c) / w, y: (d * x + e * y + f) / w };
    if (Number.isFinite(projected.x) && Number.isFinite(projected.y)) return projected;
  };
}

export function calibrateGroundZone(zone: GroundZone) {
  if (zone.checks.some(({ image, floor }) => zone.landmarks.some((mark) =>
    (mark.image.x === image.x && mark.image.y === image.y)
    || (mark.floor.x === floor.x && mark.floor.y === floor.y)))) return;
  const toFloor = fit(zone.landmarks, 'image', 'floor');
  const toImage = fit(zone.landmarks, 'floor', 'image');
  if (!toFloor || !toImage) return;
  for (const { image, floor } of zone.landmarks) {
    if (!toFloor(image) || !toImage(floor)) return;
  }
  const errorM = Math.max(...zone.checks.map(({ image, floor }) => {
    const projected = toFloor(image);
    return projected ? Math.hypot(projected.x - floor.x, projected.y - floor.y) : Infinity;
  }));
  if (errorM > zone.maxErrorM) return;
  const outline = zone.points.map(toImage);
  if (!outline.every((point): point is Point => point !== undefined)) return;
  return { toFloor, outline, errorM };
}
