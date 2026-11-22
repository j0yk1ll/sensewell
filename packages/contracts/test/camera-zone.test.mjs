import assert from 'node:assert/strict';
import test from 'node:test';
import { calibratedZoneInput, cameraZoneInput } from '../dist/index.js';

const triangle = [{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.4 }, { x: 0.4, y: 0.9 }];

test('camera zone input accepts a polygon and trims its name', () => {
  assert.deepEqual(cameraZoneInput.parse({ name: ' Rack-side aisle ', points: triangle }), {
    name: 'Rack-side aisle',
    points: triangle,
  });
});

test('camera zone input rejects malformed names and outlines', () => {
  const malformedZones = [
    { name: 'Rack' + String.fromCharCode(0) + ' aisle', points: triangle },
    { name: 'Out of frame', points: [{ x: -0.1, y: 0 }, ...triangle] },
    { name: 'Crossed edges', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }, { x: 1, y: 0 }] },
    { name: 'Collinear outline', points: [{ x: 0, y: 0 }, { x: 1e-200, y: 0 }, { x: 2e-200, y: 0 }] },
  ];
  for (const zone of malformedZones) {
    assert.equal(cameraZoneInput.safeParse(zone).success, false, zone.name);
  }
});

test('calibrates a perspective floor zone and validates an independent reference position', () => {
  const landmark = (x, y, u, v) => ({ floor: { x, y }, image: { x: u, y: v } });
  const ground = {
    landmarks: [
      landmark(0, 0, 0.2, 0.3), landmark(4, 0, 0.6, 0.3),
      landmark(4, 3, 0.48, 0.42), landmark(0, 3, 0.16, 0.42),
    ],
    checks: [landmark(2, 2, 12 / 35, 27 / 70)],
    maxErrorM: 0.01, personToleranceM: 0.2, vehicleToleranceM: 0.6,
    points: [{ x: 1, y: 0 }, { x: 3, y: 0 }, { x: 3, y: 3 }, { x: 1, y: 3 }],
  };
  const expected = [{ x: 0.3, y: 0.3 }, { x: 0.5, y: 0.3 }, { x: 0.4, y: 0.42 }, { x: 0.24, y: 0.42 }];
  const input = { name: 'Loading', points: expected, ground };
  const zone = calibratedZoneInput(cameraZoneInput.parse(input));
  assert.equal(zone.points.length, 4);
  for (const [index, point] of zone.points.entries()) {
    assert.ok(Math.hypot(point.x - expected[index].x, point.y - expected[index].y) < 1e-7);
  }
  assert.equal(calibratedZoneInput({ ...input, ground: { ...ground, checks: [landmark(2, 2, 0.4, 0.4)] } }), undefined);
  assert.equal(calibratedZoneInput({ ...input, ground: { ...ground, checks: [ground.landmarks[0]] } }), undefined);
  assert.equal(calibratedZoneInput({ ...input, ground: { ...ground, landmarks: ground.landmarks.map(() => ground.landmarks[0]) } }), undefined);
});
