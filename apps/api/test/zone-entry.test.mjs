import assert from 'node:assert/strict';
import { test } from 'node:test';
import { detectorFrameAnalysis, zoneEntryRuleInput } from '@sensewell/contracts';
import { ZoneEntryEvaluator } from '../dist/zone-entry.js';

const rule = {
  id: 'rack-side', name: 'Rack-side entry', zoneName: 'Rack-side floor', revision: 1, minimumConfidence: 0.5, eventType: 'both', objectTypes: ['person'],
  points: [{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }],
};
const person = (x, confidence = 0.8) => ({ box: [x - 0.1, 0.2, x + 0.1, 0.6], confidence, objectType: 'person' });

test('records an outside-to-inside crossing with its qualifying detection', () => {
  const pass = new ZoneEntryEvaluator();
  assert.deepEqual(pass.observe(0, [person(0.39)], [rule]), []);
  const inside = person(0.43, 0.5);
  assert.deepEqual(pass.observe(100, [inside], [rule]), [{ rule, detection: inside, direction: 'entry' }]);
  assert.deepEqual(pass.observe(200, [inside], [rule]), []);
});

test('a filtered or missing observation cannot establish an outside position', () => {
  const inside = person(0.43);
  const outside = person(0.39);
  for (const interruption of [[], [person(0.39, 0.49)]]) {
    const pass = new ZoneEntryEvaluator();
    assert.deepEqual(pass.observe(0, [inside], [rule]), []);
    assert.deepEqual(pass.observe(100, interruption, [rule]), []);
    assert.deepEqual(pass.observe(200, [inside], [rule]), []);
    assert.deepEqual(pass.observe(300, [outside], [rule]), [{ rule, detection: outside, direction: 'exit' }]);
    assert.deepEqual(pass.observe(400, [inside], [rule]), [{ rule, detection: inside, direction: 'entry' }]);
  }
});

test('a crossing across an occluded observation remains unconfirmed', () => {
  for (const interruption of [[], [person(0.39, 0.49)]]) {
    const pass = new ZoneEntryEvaluator();
    pass.observe(0, [person(0.39)], [rule]);
    pass.observe(100, interruption, [rule]);
    assert.deepEqual(pass.observe(200, [person(0.43)], [rule]), []);
  }
});

test('track state is isolated across replay passes and ambiguous associations', () => {
  const firstPass = new ZoneEntryEvaluator();
  const secondPass = new ZoneEntryEvaluator();
  firstPass.observe(0, [person(0.39)], [rule]);
  assert.deepEqual(secondPass.observe(0, [person(0.43)], [rule]), []);
  assert.deepEqual(firstPass.observe(100, [person(0.43), person(0.41)], [rule]), []);
});

test('enabling a rule or changing its zone cannot create a crossing on its own', () => {
  const pass = new ZoneEntryEvaluator();
  pass.observe(0, [person(0.39)], []);
  pass.observe(100, [person(0.39)], [rule]);
  assert.deepEqual(pass.observe(200, [person(0.43)], [{ ...rule, revision: 2 }]), []);
  pass.observe(300, [person(0.39)], [rule]);
  const moved = { ...rule, points: rule.points.map(({ x, y }) => ({ x: x - 0.1, y })) };
  assert.deepEqual(pass.observe(400, [person(0.39)], [moved]), []);
});

test('brief sampling skips keep a credible track while a longer gap starts fresh state', () => {
  const pass = new ZoneEntryEvaluator();
  const inside = person(0.43);
  pass.observe(0, [person(0.39)], [rule]);
  assert.deepEqual(pass.observe(400, [inside], [rule]), [{ rule, detection: inside, direction: 'entry' }]);
  pass.observe(500, [person(0.39)], [rule]);
  assert.deepEqual(pass.observe(1000, [inside], [rule]), []);
  pass.observe(1100, [person(0.39)], [rule]);
  assert.deepEqual(pass.observe(1700, [inside], [rule]), []);
});

test('records a separate exit when the same person leaves the zone', () => {
  const pass = new ZoneEntryEvaluator();
  const outside = person(0.39);
  const inside = person(0.43);
  pass.observe(0, [outside], [rule]);
  pass.observe(100, [inside], [rule]);
  assert.deepEqual(pass.observe(200, [outside], [rule]), [{ rule, detection: outside, direction: 'exit' }]);
  assert.deepEqual(pass.observe(300, [outside], [rule]), []);
});

test('records only the directions selected by each rule', () => {
  const pass = new ZoneEntryEvaluator();
  const outside = person(0.39);
  const inside = person(0.43);
  const rules = [
    { ...rule, id: 'entries', eventType: 'entry' },
    { ...rule, id: 'exits', eventType: 'exit' },
    { ...rule, id: 'both', eventType: 'both' },
  ];
  assert.deepEqual(pass.observe(0, [outside], rules), []);
  assert.deepEqual(pass.observe(100, [inside], rules).map(({ rule, direction }) => [rule.id, direction]),
    [['entries', 'entry'], ['both', 'entry']]);
  assert.deepEqual(pass.observe(200, [outside], rules).map(({ rule, direction }) => [rule.id, direction]),
    [['exits', 'exit'], ['both', 'exit']]);
});

test('uses positive box overlap even when the person’s feet are outside the zone', () => {
  const pass = new ZoneEntryEvaluator();
  const upperZone = { ...rule, points: [
    { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.9, y: 0.35 }, { x: 0.5, y: 0.35 },
  ] };
  const overlaps = person(0.45);
  const touches = { box: [0.3, 0.2, 0.5, 0.6], confidence: 0.8, objectType: 'person' };
  assert.deepEqual(pass.observe(0, [touches], [upperZone]), []);
  assert.deepEqual(pass.observe(100, [overlaps], [upperZone]), [{ rule: upperZone, detection: overlaps, direction: 'entry' }]);
  assert.deepEqual(pass.observe(200, [touches], [upperZone]), [{ rule: upperZone, detection: touches, direction: 'exit' }]);
});

test('rules select object classes and tracks cannot switch classes', () => {
  const pass = new ZoneEntryEvaluator();
  const vehicleRule = { ...rule, objectTypes: ['forklift', 'pallet_jack'] };
  const outside = person(0.39);
  const insideForklift = { ...person(0.43), objectType: 'forklift' };
  assert.deepEqual(pass.observe(0, [outside], [vehicleRule]), []);
  assert.deepEqual(pass.observe(100, [insideForklift], [vehicleRule]), []);

  const outsideForklift = { ...outside, objectType: 'forklift' };
  const outsideJack = { ...outside, objectType: 'pallet_jack' };
  const insideJack = { ...insideForklift, objectType: 'pallet_jack' };
  pass.observe(200, [outsideForklift, outsideJack, outside], [vehicleRule]);
  assert.deepEqual(pass.observe(300, [insideForklift, insideJack, person(0.43)], [vehicleRule]), [
    { rule: vehicleRule, detection: insideForklift, direction: 'entry' },
    { rule: vehicleRule, detection: insideJack, direction: 'entry' },
  ]);
});

test('an enabled multi-class rule does not join a person and forklift into one track', () => {
  const pass = new ZoneEntryEvaluator();
  const multiClassRule = { ...rule, objectTypes: ['person', 'forklift'] };
  assert.deepEqual(pass.observe(0, [person(0.39)], [multiClassRule]), []);
  const forklift = { ...person(0.43), objectType: 'forklift' };
  assert.deepEqual(pass.observe(100, [forklift], [multiClassRule]), []);
});

test('legacy detector results are person detections and rules reject invalid object selections', () => {
  const { box, confidence } = person(0.39);
  assert.deepEqual(detectorFrameAnalysis.parse({ state: 'analyzed', people: [{ box, confidence }] }), {
    state: 'analyzed', detections: [{ box, confidence, objectType: 'person' }],
  });
  const input = { zoneId: '9e3cb3cb-1e70-4b5d-84f0-4f4ad5aeb4fd', name: 'Traffic', minimumConfidence: 0.5 };
  for (const objectTypes of [[], ['unknown'], ['forklift', 'forklift']]) {
    assert.equal(zoneEntryRuleInput.safeParse({ ...input, objectTypes }).success, false);
  }
});

test('exposes a possible crossing with both observations and an unknown visit entry', () => {
  for (const interruption of [[], [person(0.39, 0.49)]]) {
    const pass = new ZoneEntryEvaluator();
    const outside = person(0.39);
    const inside = person(0.43);
    pass.evaluate(0, [outside], [rule]);
    const unknown = pass.evaluate(100, interruption, [rule]).evidence.rules[0];
    assert.equal(unknown.inside.length, 0);
    assert.deepEqual(unknown.unknownTrackIds, [1]);
    assert.deepEqual(unknown.gaps, [{ trackId: 1, startMs: 0, endMs: null, reason: 'missing' }]);
    const { crossings, evidence } = pass.evaluate(200, [inside], [rule]);
    assert.deepEqual(crossings, []);
    const [crossing] = evidence.rules[0].crossings;
    assert.equal(crossing.certainty, 'possible');
    assert.equal(crossing.direction, 'entry');
    assert.deepEqual(crossing.before, { sourceMs: 0, detection: outside, points: rule.points });
    assert.deepEqual(crossing.after, { sourceMs: 200, detection: inside, points: rule.points });
    assert.deepEqual(evidence.rules[0].gaps.map(({ startMs, endMs }) => [startMs, endMs]), [[0, 200]]);
    const [visit] = evidence.rules[0].visits;
    assert.equal(visit.entry, null);
    assert.equal(visit.trackId, crossing.trackId);
    assert.equal(evidence.rules[0].inside[0].trackId, crossing.trackId);
  }
});

const image = (x, y) => ({ x, y });
const floor = (x, y) => ({ x, y });
const landmark = (x, y) => ({ image: image(x, y), floor: floor(x * 10, y * 10) });
const groundRule = {
  ...rule,
  ground: {
    landmarks: [landmark(0.1, 0.1), landmark(0.9, 0.1), landmark(0.9, 0.9), landmark(0.1, 0.9)],
    checks: [landmark(0.55, 0.45)],
    maxErrorM: 0.05,
    personToleranceM: 0.1,
    vehicleToleranceM: 0.4,
    points: rule.points.map(({ x, y }) => floor(10 * x, 10 * y)),
  },
};
const withFeet = (center, ankles) => ({
  ...person(center),
  ankles: ankles.map((x) => x === null ? null : image(x, 0.59)),
});

test('uses visible ankles on the floor plan even when the detection box crosses first', () => {
  const pass = new ZoneEntryEvaluator();
  const outside = withFeet(0.39, [0.38, 0.40]);
  const boxOnly = withFeet(0.45, [0.44, 0.46]);
  const step = withFeet(0.48, [0.46, 0.53]);

  pass.evaluate(0, [outside], [groundRule]);
  const overlap = pass.evaluate(100, [boxOnly], [groundRule]);
  assert.deepEqual(overlap.crossings, []);
  assert.equal(overlap.evidence.rules[0].positions[0].ground.state, 'outside');
  const crossing = pass.evaluate(200, [step], [groundRule]);
  assert.deepEqual(crossing.crossings.map(({ direction }) => direction), ['entry']);
  const evidence = crossing.evidence.rules[0].crossings[0];
  assert.equal(evidence.before.sourceMs, 100);
  assert.equal(evidence.after.sourceMs, 200);
  assert.equal(evidence.after.ground.state, 'inside');
  assert.ok(Math.abs(evidence.after.ground.points[1].floor.x - 5.3) < 1e-8);
});

test('occluded ankles leave an inspectable gap and cannot confirm a crossing or continuous dwell', () => {
  const pass = new ZoneEntryEvaluator();
  pass.evaluate(0, [withFeet(0.46, [0.45, 0.46])], [groundRule]);
  pass.evaluate(100, [withFeet(0.52, [0.52, 0.56])], [groundRule]);
  const concealed = pass.evaluate(200, [withFeet(0.52, [null, null])], [groundRule]).evidence.rules[0];
  assert.equal(concealed.positions[0].ground.reason, 'ground-obscured');
  assert.deepEqual(concealed.unknownTrackIds, [1]);
  assert.equal(concealed.visits[0].state, 'partial');
  assert.equal(concealed.visits[0].lastInside.sourceMs, 100);

  const resumed = pass.evaluate(300, [withFeet(0.52, [0.52, 0.56])], [groundRule]).evidence.rules[0];
  assert.equal(resumed.visits[0].entry, null);
  assert.equal(resumed.visits[0].firstInside.sourceMs, 300);
  assert.equal(resumed.gaps[0].observation.sourceMs, 200);
  pass.evaluate(400, [withFeet(0.52, [null, null])], [groundRule]);
  const outside = pass.evaluate(500, [withFeet(0.46, [0.45, 0.46])], [groundRule]);
  assert.deepEqual(outside.crossings, []);
  assert.equal(outside.evidence.rules[0].crossings[0].certainty, 'possible');
});

test('forklift wheel-line jitter, brief occlusion and ambiguous passing cannot confirm a crossing', () => {
  const forklift = (x, bottom = 0.65) => ({ ...person(x), objectType: 'forklift', box: [x - 0.1, 0.2, x + 0.1, bottom] });
  const rule = { ...groundRule, objectTypes: ['forklift'] };
  const pass = new ZoneEntryEvaluator();
  pass.evaluate(0, [forklift(0.43)], [rule]);
  for (const [ms, x] of [[100, 0.495], [200, 0.505]]) {
    const jitter = pass.evaluate(ms, [forklift(x)], [rule]);
    assert.deepEqual(jitter.crossings, []);
    assert.equal(jitter.evidence.rules[0].positions[0].ground.reason, 'near-boundary');
  }
  const recovered = pass.evaluate(300, [forklift(0.56)], [rule]);
  assert.deepEqual(recovered.crossings.map(({ direction }) => direction), ['entry']);
  assert.equal(recovered.evidence.rules[0].crossings[0].before.sourceMs, 0);
  assert.equal(recovered.evidence.rules[0].crossings[0].after.sourceMs, 300);
  const occluded = pass.evaluate(400, [forklift(0.57), { ...person(0.58), box: [0.53, 0.6, 0.63, 0.72] }], [rule]);
  assert.equal(occluded.evidence.rules[0].positions[0].ground.reason, 'ground-obscured');
  const apart = pass.evaluate(500, [forklift(0.56), forklift(0.75)], [rule]);
  assert.deepEqual(apart.evidence.rules[0].positions.map(({ trackId }) => trackId), [1, 3]);
  const passing = pass.evaluate(600, [forklift(0.652), forklift(0.658)], [rule]);
  assert.deepEqual(passing.crossings, []);
  assert.deepEqual(passing.evidence.rules[0].gaps.filter(({ reason }) => reason === 'ambiguous').map(({ trackId }) => trackId), [1, 3]);
  assert.ok(passing.evidence.rules[0].positions.every(({ trackId }) => trackId > 3));
});

test('a forklift briefly disappearing beside a similar track leaves both identities uncertain', () => {
  const forklift = (x) => ({ ...person(x), objectType: 'forklift' });
  const pass = new ZoneEntryEvaluator();
  const rule = { ...groundRule, objectTypes: ['forklift'] };
  pass.evaluate(0, [forklift(0.455), forklift(0.655)], [rule]);
  const narrowed = pass.evaluate(400, [forklift(0.545)], [rule]);
  assert.deepEqual(narrowed.crossings, []);
  assert.deepEqual(narrowed.evidence.rules[0].gaps.map(({ reason }) => reason), ['ambiguous', 'ambiguous']);
  assert.ok(narrowed.evidence.rules[0].positions[0].trackId > 2);
});

test('a visible boundary band can support an exit while leaving the dwell interval partial', () => {
  const forklift = (x) => ({ ...person(x), objectType: 'forklift' });
  const pass = new ZoneEntryEvaluator();
  const rule = { ...groundRule, objectTypes: ['forklift'] };
  pass.evaluate(0, [forklift(0.45)], [rule]);
  pass.evaluate(100, [forklift(0.55)], [rule]);
  const boundary = pass.evaluate(200, [forklift(0.505)], [rule]);
  assert.equal(boundary.evidence.rules[0].visits[0].state, 'partial');
  const outside = pass.evaluate(300, [forklift(0.45)], [rule]);
  assert.deepEqual(outside.crossings.map(({ direction }) => direction), ['exit']);
  assert.ok(outside.evidence.rules[0].visits.every(({ state }) => state !== 'complete'));
});
