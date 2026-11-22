import { calibrateGroundZone, type GroundDecision, type GroundZone, type ObjectDetection, type ZonePoint } from '@sensewell/contracts';

type Calibration = ReturnType<typeof calibrateGroundZone>;
const wheeled = new Set(['forklift', 'cart', 'pallet_jack', 'amr']);

function classify({ x, y }: ZonePoint, polygon: ZonePoint[], tolerance: number) {
  let inside = false;
  for (const [index, a] of polygon.entries()) {
    const b = polygon[(index + 1) % polygon.length]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    if (Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <= tolerance) return 'unknown';
    if ((a.y > y) !== (b.y > y) && x < a.x + (y - a.y) * dx / dy) inside = !inside;
  }
  return inside ? 'inside' : 'outside';
}

export function groundPosition(
  detection: ObjectDetection, detections: ObjectDetection[], zone: GroundZone, calibration: Calibration,
): GroundDecision {
  const person = detection.objectType === 'person';
  const method = person ? 'ankles' : wheeled.has(detection.objectType) ? 'wheel-line-proxy' : null;
  const unknown = (reason: GroundDecision['reason'], points: GroundDecision['points'] = []): GroundDecision =>
    ({ state: 'unknown', reason, method, points });
  if (!method) return unknown('unsupported-object');
  if (!calibration) return unknown('projection-unavailable');

  const [left, , right, bottom] = detection.box;
  const completeWheelLine = left > 0.005 && right < 0.995 && bottom < 0.995;
  const contacts: (ZonePoint | null)[] = person ? detection.ankles ?? []
    : completeWheelLine ? [{ x: (left + right) / 2, y: bottom }] : [];
  const visible = contacts.filter((point): point is ZonePoint => {
    if (!point) return false;
    return !detections.some((other) => {
      if (other === detection) return false;
      const [left, top, right, bottom] = other.box;
      return point.x >= left && point.x <= right && point.y >= top && point.y <= bottom;
    });
  });
  const points = visible.flatMap((image) => {
    const floor = calibration.toFloor(image);
    return floor ? [{ image, floor }] : [];
  });
  const tolerance = calibration.errorM + (person ? zone.personToleranceM : zone.vehicleToleranceM);
  const states = points.map(({ floor }) => classify(floor, zone.points, tolerance));
  if (states.includes('inside')) return { state: 'inside', reason: null, method, points };
  if (states.length < (person ? 2 : 1)) {
    return unknown(visible.length > points.length ? 'projection-unavailable' : 'ground-obscured', points);
  }
  if (states.includes('unknown')) return unknown('near-boundary', points);
  return { state: 'outside', reason: null, method, points };
}
