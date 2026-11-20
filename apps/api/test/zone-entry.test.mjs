import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZoneEntryEvaluator } from '../dist/zone-entry.js';

const rule = {
  id: 'rack-side', revision: 1, minimumConfidence: 0.5,
  points: [{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }],
};
const person = (x, confidence = 0.8) => ({ box: [x - 0.1, 0.2, x + 0.1, 0.6], confidence });

test('records an outside-to-inside crossing with its qualifying detection', () => {
  const pass = new ZoneEntryEvaluator();
  assert.deepEqual(pass.observe(0, [person(0.48)], [rule]), []);
  const inside = person(0.52, 0.5);
  assert.deepEqual(pass.observe(100, [inside], [rule]), [{ rule, person: inside, direction: 'entry' }]);
  assert.deepEqual(pass.observe(200, [inside], [rule]), []);
});

test('a filtered or missing observation cannot establish an outside position', () => {
  const inside = person(0.52);
  const outside = person(0.48);
  for (const interruption of [[], [person(0.48, 0.49)]]) {
    const pass = new ZoneEntryEvaluator();
    assert.deepEqual(pass.observe(0, [inside], [rule]), []);
    assert.deepEqual(pass.observe(100, interruption, [rule]), []);
    assert.deepEqual(pass.observe(200, [inside], [rule]), []);
    assert.deepEqual(pass.observe(300, [outside], [rule]), [{ rule, person: outside, direction: 'exit' }]);
    assert.deepEqual(pass.observe(400, [inside], [rule]), [{ rule, person: inside, direction: 'entry' }]);
  }
});

test('a crossing across an occluded observation remains unconfirmed', () => {
  for (const interruption of [[], [person(0.48, 0.49)]]) {
    const pass = new ZoneEntryEvaluator();
    pass.observe(0, [person(0.48)], [rule]);
    pass.observe(100, interruption, [rule]);
    assert.deepEqual(pass.observe(200, [person(0.52)], [rule]), []);
  }
});

test('track state is isolated across replay passes and ambiguous associations', () => {
  const firstPass = new ZoneEntryEvaluator();
  const secondPass = new ZoneEntryEvaluator();
  firstPass.observe(0, [person(0.48)], [rule]);
  assert.deepEqual(secondPass.observe(0, [person(0.52)], [rule]), []);
  assert.deepEqual(firstPass.observe(100, [person(0.52), person(0.5)], [rule]), []);
});

test('enabling a rule or changing its zone cannot create a crossing on its own', () => {
  const pass = new ZoneEntryEvaluator();
  pass.observe(0, [person(0.48)], []);
  pass.observe(100, [person(0.48)], [rule]);
  assert.deepEqual(pass.observe(200, [person(0.52)], [{ ...rule, revision: 2 }]), []);
  pass.observe(300, [person(0.48)], [rule]);
  const moved = { ...rule, points: rule.points.map(({ x, y }) => ({ x: x - 0.1, y })) };
  assert.deepEqual(pass.observe(400, [person(0.48)], [moved]), []);
});

test('brief sampling skips keep a credible track while a longer gap starts fresh state', () => {
  const pass = new ZoneEntryEvaluator();
  const inside = person(0.52);
  pass.observe(0, [person(0.48)], [rule]);
  assert.deepEqual(pass.observe(400, [inside], [rule]), [{ rule, person: inside, direction: 'entry' }]);
  pass.observe(500, [person(0.48)], [rule]);
  assert.deepEqual(pass.observe(1000, [inside], [rule]), []);
  pass.observe(1100, [person(0.48)], [rule]);
  assert.deepEqual(pass.observe(1700, [inside], [rule]), []);
});

test('records a separate exit when the same person leaves the zone', () => {
  const pass = new ZoneEntryEvaluator();
  const outside = person(0.48);
  const inside = person(0.52);
  pass.observe(0, [outside], [rule]);
  pass.observe(100, [inside], [rule]);
  assert.deepEqual(pass.observe(200, [outside], [rule]), [{ rule, person: outside, direction: 'exit' }]);
  assert.deepEqual(pass.observe(300, [outside], [rule]), []);
});
