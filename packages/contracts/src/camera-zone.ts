import { z } from 'zod';

export const maxZoneNameLength = 100;
export const maxZonePoints = 32;

// Coordinates are fractions of the source image, measured from its top left.
const coordinate = z.number().min(0).max(1);
const zonePoint = z.strictObject({ x: coordinate, y: coordinate });
export type ZonePoint = z.infer<typeof zonePoint>;

function turn(a: ZonePoint, b: ZonePoint, c: ZonePoint) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: ZonePoint, b: ZonePoint, p: ZonePoint) {
  return p.x >= Math.min(a.x, b.x) && p.x <= Math.max(a.x, b.x)
    && p.y >= Math.min(a.y, b.y) && p.y <= Math.max(a.y, b.y);
}

function edgesIntersect(a: ZonePoint, b: ZonePoint, c: ZonePoint, d: ZonePoint) {
  const abc = turn(a, b, c);
  const abd = turn(a, b, d);
  const cda = turn(c, d, a);
  const cdb = turn(c, d, b);
  return (((abc < 0 && abd > 0) || (abc > 0 && abd < 0))
      && ((cda < 0 && cdb > 0) || (cda > 0 && cdb < 0)))
    || (abc === 0 && onSegment(a, b, c))
    || (abd === 0 && onSegment(a, b, d))
    || (cda === 0 && onSegment(c, d, a))
    || (cdb === 0 && onSegment(c, d, b));
}

function isPolygon(points: ZonePoint[]) {
  if (new Set(points.map(({ x, y }) => `${x},${y}`)).size !== points.length) return false;
  const origin = points[0];
  if (!origin) return false;
  const edges = points.map((start, i) => ({ start, end: points[i + 1] ?? origin }));
  const twiceArea = edges.reduce((sum, { start, end }) => sum + turn(origin, start, end), 0);
  if (twiceArea === 0) return false;

  for (const [i, { start: a, end: b }] of edges.entries()) {
    const c = (edges[i + 1] ?? edges[0])?.end ?? a;
    // Consecutive collinear edges are allowed if they keep going in the same direction.
    if (turn(a, b, c) === 0 && (onSegment(a, b, c) || onSegment(b, c, a))) {
      return false;
    }
    const afterAdjacent = i === 0 ? edges.slice(2, -1) : edges.slice(i + 2);
    for (const { start, end } of afterAdjacent) {
      if (edgesIntersect(a, b, start, end)) return false;
    }
  }
  return true;
}

export const cameraZoneInput = z.strictObject({
  name: z.string().trim().min(1).max(maxZoneNameLength)
    .refine((name) => !name.includes(String.fromCharCode(0)), 'Enter a valid zone name.'),
  points: z.array(zonePoint).min(3).max(maxZonePoints)
    .refine(isPolygon, 'Draw an outline with distinct corners and edges that do not cross.'),
});
export const cameraZone = cameraZoneInput.extend({ id: z.uuid() });
export const cameraZoneList = z.array(cameraZone);

export type CameraZoneInput = z.infer<typeof cameraZoneInput>;
export type CameraZone = z.infer<typeof cameraZone>;
