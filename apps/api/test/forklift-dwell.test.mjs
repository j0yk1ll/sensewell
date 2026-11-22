import assert from 'node:assert/strict';
import process from 'node:process';
import { test } from 'node:test';
import { evaluateForkliftDwell } from '../dist/forklift-dwell.js';

const startMs = 1000;
const endMs = 320000;
const condition = {
  operator: 'continuous-presence', subject: 'same-forklift', durationMs: 300000,
  zone: {
    id: 'loading', name: 'Loading', points: [{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }],
  },
};
const forklift = (right) => ({ objectType: 'forklift', confidence: 0.9, box: [right - 0.2, 0.3, right, 0.6] });
const outside = forklift(0.49);
const inside = forklift(0.51);
const entryMs = 1200;

function segment(id, fromMs, toMs, detections) {
  const frames = [];
  for (let atMs = fromMs; atMs < toMs; atMs += 200) {
    frames.push({ offsetMs: atMs - fromMs, detections: detections(atMs) });
  }
  return { id, startMs: fromMs, endMs: toMs, frames };
}
const view = (ms) => [ms < entryMs ? outside : inside];
const original = segment('original', startMs, endMs, view);

test('records one match at five minutes with entry and threshold playback', () => {
  const result = evaluateForkliftDwell(condition, [original], { startMs, endMs });
  assert.deepEqual(result.matches, [{
    entryMs, occurrenceMs: 301200, establishedMs: 301200, occurrenceKey: 'original:200:0',
    qualificationBox: inside.box,
    evidence: [{ recordingId: 'original', offsetMs: 200 }, { recordingId: 'original', offsetMs: 300200 }],
  }]);
  assert.deepEqual(result.undecided, []);
});

test('reports a coverage gap unless an overlapping recording supports continuity', () => {
  const interrupted = segment('interrupted', startMs, endMs, (ms) => ms >= 151000 && ms < 152000 ? null : view(ms));
  const gap = evaluateForkliftDwell(condition, [interrupted], { startMs, endMs });
  assert.deepEqual(gap.matches, []);
  assert.ok(gap.undecided.some((interval) => interval.startMs <= 151000 && interval.endMs >= 152000));
  const overlap = segment('overlap', 150700, 152300, view);
  assert.equal(evaluateForkliftDwell(condition, [interrupted, overlap], { startMs, endMs }).matches.length, 1);
});

test('an entry before activation can only match in historical evaluation', () => {
  const range = { startMs, endMs };
  assert.equal(evaluateForkliftDwell(condition, [original], range).matches.length, 1);
  assert.deepEqual(evaluateForkliftDwell(condition, [original], range, 2000).matches, []);
});

test('a different track after a missing observation cannot inherit the dwell', () => {
  const interrupted = segment('interrupted', startMs, endMs, (ms) => ms === 151000 ? [] : view(ms));
  const result = evaluateForkliftDwell(condition, [interrupted], { startMs, endMs });
  assert.deepEqual(result.matches, []);
  assert.ok(result.undecided.length);
});

test('staggered timestamps in overlapping footage can cover an unavailable sample', () => {
  const interrupted = segment('interrupted', startMs, endMs, (ms) => ms >= 151000 && ms < 152000 ? null : view(ms));
  const overlap = segment('staggered', 150750, 152400, view);
  overlap.frames = overlap.frames.filter(({ offsetMs }) => offsetMs % 400 === 0);
  const result = evaluateForkliftDwell(condition, [interrupted, overlap], { startMs, endMs });
  assert.equal(result.matches.length, 1);
});

test('publication honors disablement, reactivation, and tenant isolation', {
  skip: !process.env.DATABASE_URL || !process.env.DATABASE_MIGRATION_URL,
}, async (t) => {
  const { randomUUID } = await import('node:crypto');
  const { createDatabase } = await import('@sensewell/database');
  // The database package owns migrations. Full-suite runs provide the migrated test database.
  const { migrateDatabase } = await import('../../../packages/database/dist/migrate.js');
  await migrateDatabase();
  const database = createDatabase();
  t.after(() => database.close());
  const tenant = randomUUID();
  const otherTenant = randomUUID();
  const cameraId = randomUUID();
  await database.cameras.addIp(tenant, { id: cameraId, name: 'Dispatch', encryptedStream: 'opaque configuration' });
  const trigger = await database.dwell.draft(tenant, cameraId, {
    ...condition, zone: { ...condition.zone, id: randomUUID() },
  });
  assert.equal(trigger.activeSince, null);
  assert.equal(trigger.reviewed, false);
  const initial = await database.dwell.setEnabled(tenant, cameraId, trigger.id, true);
  assert.ok(initial?.activeSince);
  assert.equal(initial.reviewed, true);

  async function prepare(base) {
    const entered = base + 200;
    const recording = segment(randomUUID(), base, base + 310000, (ms) => [ms < entered ? outside : inside]);
    const row = { id: recording.id, startedAt: new Date(base), endedAt: new Date(recording.endMs) };
    await database.recordings.add(tenant, { ...row, cameraId });
    return {
      entered, range: { startMs: base, endMs: recording.endMs },
      publish: () => database.dwell.publish(tenant, cameraId, row, recording.frames,
        ({ condition: approved, activeSince, cameraId }, recordings, range) =>
          evaluateForkliftDwell(approved, recordings, range, activeSince.getTime(), cameraId).matches),
    };
  }

  const beforeEnable = await prepare(initial.activeSince.getTime() - 310500);
  await beforeEnable.publish();
  assert.deepEqual(await database.dwell.history(tenant, cameraId), []);
  const delayed = await prepare(initial.activeSince.getTime() + 1000);
  await database.dwell.setEnabled(tenant, cameraId, trigger.id, false);
  await delayed.publish();
  assert.deepEqual(await database.dwell.history(tenant, cameraId), []);
  for (const { range } of [beforeEnable, delayed]) {
    const recordings = await database.dwell.recordings(tenant, cameraId, range);
    assert.equal(evaluateForkliftDwell(trigger.condition, recordings, range, undefined, cameraId).matches.length, 1);
  }
  assert.deepEqual(await database.dwell.history(tenant, cameraId), []);

  const reactivated = await database.dwell.setEnabled(tenant, cameraId, trigger.id, true);
  assert.ok(reactivated.activeSince > initial.activeSince);
  const repeatedEnable = await database.dwell.setEnabled(tenant, cameraId, trigger.id, true);
  assert.deepEqual(repeatedEnable.activeSince, reactivated.activeSince);
  const live = await prepare(delayed.range.endMs + 1000);
  await Promise.all([live.publish(), live.publish()]);

  // An overlapping segment can move the first observed inside sample without creating a second dwell.
  const base = live.range.startMs + 100;
  const overlap = segment(randomUUID(), base, base + 1500, () => [inside]);
  const overlapRow = { id: overlap.id, startedAt: new Date(base), endedAt: new Date(overlap.endMs) };
  await database.recordings.add(tenant, { ...overlapRow, cameraId });
  await database.dwell.publish(tenant, cameraId, overlapRow, overlap.frames,
    ({ condition: approved, activeSince, cameraId }, recordings, range, published) =>
      evaluateForkliftDwell(approved, recordings, range, activeSince.getTime(), cameraId, published).matches);
  const history = await database.dwell.history(tenant, cameraId);
  assert.equal(history.length, 1);
  assert.deepEqual(history[0].condition, trigger.condition);
  assert.equal(history[0].match.occurrenceMs, live.entered + 300000);
  const recordingId = history[0].match.evidence[1].recordingId;
  assert.deepEqual(await database.dwell.eventEvidence(tenant, cameraId, history[0].id, recordingId), { cameraId, recordingId });
  assert.equal(await database.dwell.eventEvidence(otherTenant, cameraId, history[0].id, recordingId), undefined);
  assert.equal(await database.dwell.eventEvidence(tenant, cameraId, history[0].id, randomUUID()), undefined);
  assert.deepEqual(await database.dwell.history(otherTenant, cameraId), []);
  assert.deepEqual(await database.dwell.recordings(otherTenant, cameraId, live.range), []);
  assert.equal(await database.dwell.setEnabled(otherTenant, cameraId, trigger.id, false), undefined);
});

test('a crossing with no outside sample after activation stays historical', () => {
  const range = { startMs, endMs };
  assert.deepEqual(evaluateForkliftDwell(condition, [original], range, 1100).matches, []);
});

test('an exit that straddles the five-minute threshold leaves it undecided', () => {
  const straddled = segment('straddled', startMs, endMs, (ms) => [ms < 301200 ? view(ms)[0] : outside]);
  straddled.frames = straddled.frames.filter(({ offsetMs }) => startMs + offsetMs !== 301200);
  const result = evaluateForkliftDwell(condition, [straddled], { startMs, endMs });
  assert.deepEqual(result.matches, []);
  assert.ok(result.undecided.some((gap) => gap.startMs < 301200 && gap.endMs > 301200));
});

test('simultaneous overlapping footage supplies a missed detection', () => {
  const interrupted = segment('interrupted', startMs, endMs, (ms) => ms === 151000 ? [] : view(ms));
  const overlap = segment('overlap', 150600, 151400, view);
  assert.equal(evaluateForkliftDwell(condition, [interrupted, overlap], { startMs, endMs }).matches.length, 1);
});

function calibratedZone(shift = 0) {
  const ground = {
    points: [{ x: 5, y: 1 }, { x: 9, y: 1 }, { x: 9, y: 9 }, { x: 5, y: 9 }],
    landmarks: [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => ({ image: { x, y }, floor: { x: 10 * x, y: 10 * y } })),
    checks: [{ image: { x: 0.3, y: 0.4 }, floor: { x: 3, y: 4 } }],
    maxErrorM: 0.1, personToleranceM: 0.05, vehicleToleranceM: 0.05,
  };
  return {
    ...condition.zone, ground: {
      ...ground,
      landmarks: ground.landmarks.map(({ image, floor }) => ({ image, floor: { ...floor, x: floor.x + shift } })),
      checks: ground.checks.map(({ image, floor }) => ({ image, floor: { ...floor, x: floor.x + shift } })),
    },
  };
}

const detected = (x) => ({ objectType: 'forklift', confidence: 0.9, box: [x - 0.1, 0.3, x + 0.1, 0.6] });

test('a calibrated second camera can support continuity across a primary camera outage', () => {
  const zone = calibratedZone();
  const shiftedZone = calibratedZone(2);
  const calibrated = { ...condition, zone, supportingViews: [{ cameraId: 'secondary', zone: shiftedZone }] };
  const subject = (ms) => [detected(ms < entryMs ? 0.48 : 0.52)];
  const first = { ...segment('first', startMs, 151000, subject), cameraId: 'primary' };
  const last = { ...segment('last', 250000, endMs, subject), cameraId: 'primary' };
  const second = { ...segment('second', 150000, endMs, () => [detected(0.32)]), cameraId: 'secondary' };
  const far = { ...segment('far', 150000, endMs, () => [detected(0.50)]), cameraId: 'secondary' };
  const range = { startMs, endMs };
  const result = evaluateForkliftDwell(calibrated, [first, last, second], range, undefined, 'primary');
  assert.equal(result.matches.length, 1);
  assert.equal(result.matches[0].occurrenceMs, 301200);
  assert.equal(evaluateForkliftDwell(calibrated, [first, last, far], range, undefined, 'primary').matches.length, 0);
  assert.ok(evaluateForkliftDwell(calibrated, [first, last, far], range, undefined, 'primary').undecided.length);
});


test('a supporting-view crossing cannot restart a dwell already in progress at activation', () => {
  const zone = calibratedZone();
  const supported = { ...condition, zone, supportingViews: [{ cameraId: 'secondary', zone }] };
  const primary = { ...segment('primary', startMs, endMs, (ms) => [detected(ms < 1200 ? 0.48 : 0.52)]), cameraId: 'primary' };
  const secondary = { ...segment('secondary', startMs, endMs, (ms) => [detected(ms < 2000 ? 0.48 : 0.52)]), cameraId: 'secondary' };
  const recordings = [primary, secondary];
  const range = { startMs, endMs };
  assert.equal(evaluateForkliftDwell(supported, recordings, range, undefined, 'primary').matches[0].entryMs, 1200);
  assert.deepEqual(evaluateForkliftDwell(supported, recordings, range, 1600, 'primary').matches, []);
});

test('a third view cannot bridge simultaneous observations of different forklifts', () => {
  const zone = calibratedZone();
  const supported = { ...condition, zone, supportingViews: [{ cameraId: 'middle', zone }, { cameraId: 'last', zone }] };
  const first = { ...segment('first', startMs, 151000, (ms) => [detected(ms < entryMs ? 0.48 : 0.52)]), cameraId: 'first' };
  const middle = { ...segment('middle', 150000, 160000, () => [detected(0.59)]), cameraId: 'middle' };
  const last = { ...segment('last', 150000, endMs, () => [detected(0.66)]), cameraId: 'last' };
  const result = evaluateForkliftDwell(supported, [first, middle, last], { startMs, endMs }, undefined, 'first');
  assert.equal(result.matches.length, 0);
  assert.ok(result.undecided.length);
});

test('rewritten overlapping samples preserve the published qualification observation', () => {
  const range = { startMs, endMs };
  const [published] = evaluateForkliftDwell(condition, [original], range).matches;
  const lateQualification = segment('qualification', 300800, 302200,
    () => [{ ...inside, box: [0.14, 0.3, 0.51, 0.6] }]);
  const lateEntry = segment('entry', 1100, 2200, () => [inside]);
  const recordings = [lateQualification, original, lateEntry];
  assert.equal(evaluateForkliftDwell(condition, recordings, range).matches[0].entryMs, 1100);
  assert.deepEqual(evaluateForkliftDwell(condition, recordings, range, undefined, undefined, [published]).matches, []);
});

test('a duplicate detector box within a forklift observation does not break its track', () => {
  const duplicate = { ...inside, box: [0.311, 0.301, 0.46, 0.599], confidence: 0.6 };
  const recording = segment('duplicate', startMs, endMs, (ms) => ms === 1800 ? [inside, duplicate] : view(ms));
  const result = evaluateForkliftDwell(condition, [recording], { startMs, endMs });
  assert.equal(result.matches.length, 1);
});

test('late supporting-camera analysis publishes an event with tenant-scoped evidence', {
  skip: !process.env.DATABASE_URL || !process.env.DATABASE_MIGRATION_URL,
}, async (t) => {
  const { randomUUID } = await import('node:crypto');
  const { createDatabase } = await import('@sensewell/database');
  const { migrateDatabase } = await import('../../../packages/database/dist/migrate.js');
  await migrateDatabase();
  const database = createDatabase();
  t.after(() => database.close());
  const tenant = randomUUID();
  const primaryId = randomUUID();
  const supportingId = randomUUID();
  for (const id of [primaryId, supportingId]) {
    await database.cameras.addIp(tenant, { id, name: 'Loading', encryptedStream: 'opaque configuration' });
  }
  const zone = { ...calibratedZone(), id: randomUUID() };
  const draft = await database.dwell.draft(tenant, primaryId, {
    ...condition, zone, supportingViews: [{ cameraId: supportingId, zone: { ...calibratedZone(2), id: randomUUID() } }],
  });
  const enabled = await database.dwell.setEnabled(tenant, primaryId, draft.id, true);
  const base = enabled.activeSince.getTime() + 1000;
  async function publish(cameraId, fromMs, toMs, observations) {
    const recording = segment(randomUUID(), base + fromMs, base + toMs, observations);
    const row = { id: recording.id, startedAt: new Date(recording.startMs), endedAt: new Date(recording.endMs) };
    await database.recordings.add(tenant, { ...row, cameraId });
    await database.dwell.publish(tenant, cameraId, row, recording.frames,
      ({ condition: approved, activeSince, cameraId }, recordings, range, published) =>
        evaluateForkliftDwell(approved, recordings, range, activeSince.getTime(), cameraId, published).matches);
    return recording.id;
  }

  await publish(primaryId, 0, 150000, (ms) => [detected(ms < base + 200 ? 0.48 : 0.52)]);
  await publish(primaryId, 312000, 320000, () => [detected(0.52)]);
  assert.deepEqual(await database.dwell.history(tenant, primaryId), []);
  const supportingRecording = await publish(supportingId, 149000, 320000, () => [detected(0.32)]);
  const history = await database.dwell.history(tenant, primaryId);
  assert.equal(history.length, 1);
  const [event] = history;
  assert.equal(event.match.occurrenceMs, base + 300200);
  assert.equal(event.match.evidence[1].recordingId, supportingRecording);
  await database.cameras.removeIp(tenant, supportingId);
  assert.deepEqual(await database.dwell.eventEvidence(tenant, primaryId, event.id, supportingRecording), {
    cameraId: supportingId, recordingId: supportingRecording,
  });
  assert.equal(await database.dwell.eventEvidence(randomUUID(), primaryId, event.id, supportingRecording), undefined);
});
