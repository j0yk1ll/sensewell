import console from 'node:console';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import { ZoneEntryEvaluator } from '../../apps/api/dist/zone-entry.js';
import { calibratedZoneInput, cameraZoneInput } from '../../packages/contracts/dist/index.js';

const [referencePath, detectionsPath] = process.argv.slice(2);
if (!referencePath || !detectionsPath) {
  throw new Error('Pass an annotation JSON file and the detector NDJSON for the same footage.');
}
const { zone, tracks, minimumConfidence = 0.25, eventWindowMs = 1000 } = JSON.parse(readFileSync(referencePath));
const calibrated = calibratedZoneInput(cameraZoneInput.parse(zone));
if (!calibrated?.ground) throw new Error('The annotated zone failed calibration.');
const rule = {
  ...calibrated, id: 'zone', revision: 1, minimumConfidence, zoneName: zone.name,
  objectTypes: [...new Set(tracks.map(({ objectType }) => objectType))], eventType: 'both',
};
const frames = readFileSync(detectionsPath, 'utf8').trim().split('\n').map(JSON.parse);
const evaluator = new ZoneEntryEvaluator();
const baseline = new ZoneEntryEvaluator();
const answers = { legacy: [], calibrated: [], possible: [] };
const lastTrack = { baseline: new Map(), calibrated: new Map() };
const states = { inside: 0, outside: 0, unknown: 0 };
let misses = 0;
const identitySwitches = { baseline: 0, calibrated: 0 };
let references = 0;
const unassignedCrossings = { legacy: 0, calibrated: 0 };
const groundErrors = [];

function anchorAt(samples, sourceMs) {
  const index = samples.findIndex(([time]) => time >= sourceMs);
  if (index === -1) return;
  const [end, x1, y1, floorX1, floorY1] = samples[index];
  if (end === sourceMs) return [x1, y1, floorX1, floorY1];
  if (index === 0) return;
  const [start, x0, y0, floorX0, floorY0] = samples[index - 1];
  const fraction = (sourceMs - start) / (end - start);
  const interpolate = (a, b) => a + fraction * (b - a);
  return [interpolate(x0, x1), interpolate(y0, y1), interpolate(floorX0, floorX1), interpolate(floorY0, floorY1)];
}

for (const { sourceMs, detections } of frames) {
  const result = evaluator.evaluate(sourceMs, detections, [rule]);
  const legacy = baseline.evaluate(sourceMs, detections, [{ ...rule, ground: undefined }]);
  const positions = result.evidence.rules.flatMap(({ positions }) => positions ?? []);
  const matched = new Map();
  for (const { id, samples, objectType } of tracks) {
    const anchor = anchorAt(samples, sourceMs);
    if (!anchor) continue;
    references += 1;
    const [x, y, floorX, floorY] = anchor;
    const distance = ({ box: [l, t, r, b] }) => Math.hypot((l + r) / 2 - x, (t + b) / 2 - y);
    const position = positions
      .filter(({ detection, detection: { box: [l, t, r, b] } }) =>
        detection.objectType === objectType && !matched.has(detection) && l <= x && x <= r && t <= y && y <= b)
      .sort((a, b) => distance(a.detection) - distance(b.detection))[0];
    if (!position) {
      misses += 1;
      continue;
    }
    matched.set(position.detection, id);
    const baselineId = legacy.trackIds[detections.indexOf(position.detection)];
    for (const [mode, trackId] of [['baseline', baselineId], ['calibrated', position.trackId]]) {
      if (lastTrack[mode].has(id) && lastTrack[mode].get(id) !== trackId) identitySwitches[mode] += 1;
      lastTrack[mode].set(id, trackId);
    }
    states[position.ground.state] += 1;
    if (Number.isFinite(floorX) && position.ground.points.length === 1 && objectType === 'forklift') {
      const { floor } = position.ground.points[0];
      groundErrors.push(Math.hypot(floor.x - floorX, floor.y - floorY));
    }
  }

  function record(group, direction, detection, countUnassigned = false) {
    const id = matched.get(detection);
    if (id) answers[group].push({ id, direction, sourceMs });
    else if (countUnassigned) unassignedCrossings[group] += 1;
  }
  for (const { direction, detection } of legacy.crossings) record('legacy', direction, detection, true);
  for (const { direction, detection } of result.crossings) record('calibrated', direction, detection, true);
  for (const { crossings } of result.evidence.rules) {
    for (const { certainty, direction, after } of crossings) {
      if (certainty === 'possible') record('possible', direction, after.detection);
    }
  }
}

const expected = tracks.flatMap(({ id, events }) => events.map((event) => ({ id, ...event })));
function score(observed) {
  const remaining = [...expected];
  const errorsMs = [];
  let falseTransitions = 0;
  for (const { id, direction, sourceMs } of observed) {
    const match = remaining
      .filter((event) => event.id === id && event.direction === direction && Math.abs(sourceMs - event.sourceMs) <= eventWindowMs)
      .sort((a, b) => Math.abs(sourceMs - a.sourceMs) - Math.abs(sourceMs - b.sourceMs))[0];
    if (match) {
      errorsMs.push(sourceMs - match.sourceMs);
      remaining.splice(remaining.indexOf(match), 1);
    } else falseTransitions += 1;
  }
  return { falseTransitions, missedTransitions: remaining.length, errorsMs, observed };
}

console.log(JSON.stringify({
  references, misses, identitySwitches, states, unassignedCrossings,
  vehicleErrorM: groundErrors.length ? { count: groundErrors.length, max: Math.max(...groundErrors) } : undefined,
  baseline: score(answers.legacy), calibrated: score(answers.calibrated), possible: answers.possible,
}, null, 2));
