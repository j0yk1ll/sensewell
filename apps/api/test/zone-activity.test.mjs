import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZoneEntryEvaluator } from '../dist/zone-entry.js';
import { summarizeZoneActivity } from '../dist/zone-activity.js';

const rule = {
  id: 'rack-side', name: 'Rack-side entry', zoneName: 'Rack-side floor',
  revision: 1, minimumConfidence: 0.5, eventType: 'entry', objectTypes: ['person'],
  points: [{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }],
};
const person = (x) => ({ box: [x - 0.1, 0.2, x + 0.1, 0.6], confidence: 0.8, objectType: 'person' });
const outside = person(0.39);
const inside = person(0.43);

function replay(evaluator, samples) {
  return samples.map(([sourceMs, detections]) => ({
    sourceMs, evidence: evaluator.evaluate(sourceMs, detections, [rule]).evidence,
  }));
}

test('counts repeat visits, shows occupancy at an observed time, and closes open visits at the loop boundary', () => {
  const first = replay(new ZoneEntryEvaluator(), [
    [0, [outside]], [100, [inside]], [200, [outside]], [300, [inside]],
  ]);
  const active = summarizeZoneActivity('first', first, true, 100).rules[0];
  assert.equal(active.entries, 2);
  assert.equal(active.distinctEntrants, 1);
  assert.equal(active.occupancy.sourceMs, 100);
  assert.equal(active.occupancy.inside.length, 1);
  assert.deepEqual(active.visits.map(({ state, entry, exit }) => [state, entry?.sourceMs, exit?.sourceMs]),
    [['open', 300, undefined], ['complete', 100, 200]]);

  const finished = summarizeZoneActivity('first', first, false).rules[0];
  assert.equal(finished.visits[0].state, 'partial');
  assert.equal(finished.visits[0].reason, 'pass-ended');
  const afterLoop = new ZoneEntryEvaluator();
  const boundary = afterLoop.evaluate(0, [outside], [rule]);
  assert.deepEqual(boundary.crossings, []);
  assert.deepEqual(boundary.evidence.rules[0].crossings, []);

  const second = replay(new ZoneEntryEvaluator(), [[0, [inside]], [100, [outside]]]);
  const next = summarizeZoneActivity('second', second, false, 0).rules[0];
  assert.equal(next.entries, 0);
  assert.equal(next.distinctEntrants, 0);
  assert.equal(next.occupancy.inside.length, 1);
  assert.equal(next.visits[0].state, 'partial');
  assert.equal(next.visits[0].entry, null);
  assert.equal(next.visits[0].exit.sourceMs, 100);
  assert.equal(summarizeZoneActivity('second', second, false, 200).rules[0].occupancy, null);
});

test('loss closes open visits and recovery retains tracks only on a unique match within the window', () => {
  for (const [reason, samples] of [
    ['ambiguous', [[200, [inside, person(0.45)]]]],
    ['expired', [[601, [inside]]]],
  ]) {
    const frames = replay(new ZoneEntryEvaluator(), [[0, [outside]], [100, [inside]], ...samples]);
    const result = summarizeZoneActivity('pass', frames, true).rules[0];
    const previous = result.visits.find(({ entry }) => entry);
    assert.equal(previous.state, 'partial');
    assert.equal(previous.reason, reason);
    assert.equal(previous.exit, null);
    assert.equal(result.gaps[0].reason, reason);
    assert.ok(result.occupancy.inside.every(({ trackId }) => trackId !== previous.trackId));
  }
  const frames = replay(new ZoneEntryEvaluator(), [
    [0, [outside]], [100, [inside]], [200, []], [600, [inside]], [700, [outside]],
  ]);
  const result = summarizeZoneActivity('pass', frames, true, 200).rules[0];
  assert.equal(result.occupancy.inside.length, 0);
  assert.deepEqual(result.occupancy.unknownTrackIds, [1]);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.visits.length, 1);
  assert.equal(result.visits[0].state, 'complete');
  assert.equal(result.gaps[0].endMs, 600);
});

test('reports a possible exit and leaves dwell unknown', () => {
  const frames = replay(new ZoneEntryEvaluator(), [
    [0, [outside]], [100, [inside]], [200, []], [300, [outside]],
  ]);
  const result = summarizeZoneActivity('pass', frames, false).rules[0];
  assert.equal(result.entries, 1);
  assert.equal(result.distinctEntrants, 1);
  assert.equal(result.crossings[0].certainty, 'possible');
  assert.equal(result.crossings[0].direction, 'exit');
  assert.equal(result.visits[0].reason, 'possible-exit');
  assert.equal(result.visits[0].exit, null);
});

test('keeps an unresolved gap visible when the pass ends before the track is recovered', () => {
  const frames = replay(new ZoneEntryEvaluator(), [[0, [inside]], [100, []]]);
  const result = summarizeZoneActivity('pass', frames, false).rules[0];
  assert.equal(result.occupancy.inside.length, 0);
  assert.deepEqual(result.occupancy.unknownTrackIds, [1]);
  assert.deepEqual(result.gaps, [{ trackId: 1, startMs: 0, endMs: null, reason: 'missing' }]);
  assert.equal(result.visits[0].state, 'partial');
});
