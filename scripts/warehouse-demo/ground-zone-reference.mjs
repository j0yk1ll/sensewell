import console from 'node:console';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { groundZoneConfig } from './ground-zones.mjs';

const [name, referencePath] = process.argv.slice(2);
if (!referencePath || !['blender-walk', 'blender-box-only', 'blender-passing', 'blender-dwell', 'real-walk', 'real-forklift'].includes(name)) {
  throw new Error('Pass a benchmark case name and its Blender manifest or NVIDIA calibration JSON.');
}
const source = JSON.parse(readFileSync(referencePath));

const entry = (sourceMs) => ({ direction: 'entry', sourceMs });
const exit = (sourceMs) => ({ direction: 'exit', sourceMs });
function project(matrix, x, y) {
  const [u, v, w] = matrix.map(([a, b, c]) => a * x + b * y + c);
  return { x: u / w, y: v / w };
}

function blenderReference(camera, zoneName, tracks) {
  return { zone: groundZoneConfig(source, camera, zoneName), tracks };
}

function forkliftReference(id, camera, startMs, endMs, events) {
  const path = source.choreography[id];
  const samples = [];
  for (let ms = startMs; ms <= endMs; ms += 100) {
    const after = path.findIndex(([second]) => second * 1000 > ms);
    let [x, y] = path.at(-1)[1];
    if (after > 0) {
      const [t0, [x0, y0]] = path[after - 1];
      const [t1, [x1, y1]] = path[after];
      const fraction = (ms / 1000 - t0) / (t1 - t0);
      x = x0 + (x1 - x0) * fraction;
      y = y0 + (y1 - y0) * fraction;
    }
    const image = project(source.cameras[camera].floorToImage, x, y);
    samples.push([ms, image.x, image.y - 0.065, x, y]);
  }
  return { id, objectType: 'forklift', samples, events };
}

function blenderWalk(zoneName, crosses) {
  const [left, near, right, far] = source.zones['pedestrian-gate'];
  const states = source.ankles.map((ankles) =>
    ankles.some(([x, y]) => left <= x && x <= right && near <= y && y <= far));
  const samples = source.ankles.slice(0, 60).map((ankles, index) => {
    const [[x1, y1], [x2, y2]] = ankles;
    const image = project(source.cameras.staging.floorToImage, (x1 + x2) / 2, (y1 + y2) / 2);
    return [index * 100, image.x, image.y - 0.12];
  });
  return blenderReference('staging', zoneName, [{
    id: 'W1', objectType: 'person', samples,
    events: crosses ? [entry(states.indexOf(true) * 100), exit((states.lastIndexOf(true) + 1) * 100)] : [],
  }]);
}

function realReference(zonePixels, name, type, samples, events) {
  // Calibration and task annotations are for Warehouse_026, Camera_0003.
  // Clicked image points below use the 960×540 working frame.
  const sensor = source.sensors.find(({ id }) => id === 'Camera_0003');
  const point = ([x, y]) => ({ x: x / 960, y: y / 540 });
  const mark = ([x, y]) => ({ image: point([x, y]), floor: project(sensor.homography, x * 2, y * 2) });
  const zone = {
    name, points: zonePixels.map(point),
    ground: {
      points: zonePixels.map((p) => mark(p).floor),
      landmarks: [[368, 247], [555, 247], [638, 450], [315, 450]].map(mark),
      checks: [[485, 315], [500, 365]].map(mark),
      maxErrorM: 0.05, personToleranceM: 0.12, vehicleToleranceM: 0.65,
    },
  };
  return {
    zone, tracks: [{ id: 'Subject 1', objectType: type,
      samples: samples.map(([time, x, y]) => [time, x / 960, y / 540]), events }],
  };
}

const cases = {
  'blender-walk': () => blenderWalk('pedestrian-gate', true),
  'blender-box-only': () => blenderWalk('staging', false),
  'blender-passing': () => blenderReference('aisle', 'transfer-aisle', [
    forkliftReference('F1', 'aisle', 9100, 16900, [exit(16000)]),
    forkliftReference('F2', 'aisle', 9100, 16900, []),
  ]),
  'blender-dwell': () => blenderReference('dispatch', 'loading-zone', [
    forkliftReference('F1', 'dispatch', 1200, 317900, [entry(4000), exit(314000)]),
  ]),
  'real-walk': () => realReference(
    [[450, 320], [525, 320], [531, 366], [433, 366]], 'Walking strip', 'person',
    [[7000, 490, 230], [9000, 491, 244], [10400, 487, 279], [11200, 483, 305], [11900, 466, 342]],
    [entry(9700), exit(11100)],
  ),
  'real-forklift': () => realReference(
    [[441, 224], [514, 224], [520, 273], [441, 273]], 'Back aisle strip', 'forklift',
    [[39500, 403, 189], [40200, 417, 188], [41400, 454, 188], [42000, 472, 182], [42600, 506, 188], [43200, 542, 177]],
    [entry(41000), exit(42900)],
  ),
};
console.log(JSON.stringify(cases[name](), null, 2));
