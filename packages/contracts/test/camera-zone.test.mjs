import assert from 'node:assert/strict';
import test from 'node:test';
import { cameraZoneInput } from '../dist/index.js';

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
