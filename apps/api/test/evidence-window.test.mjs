import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evidenceWindow } from '../dist/clip-storage.js';

const camera = { startOffsetMs: 200, durationMs: 60_000 };

test('uses three seconds on either side of the crossing', () => {
  assert.deepEqual(evidenceWindow(13_800, camera), { startMs: 10_800, endMs: 16_800 });
});

test('clamps the evidence window to the playable clip boundaries', () => {
  assert.deepEqual(evidenceWindow(1000, camera), { startMs: 200, endMs: 4000 });
  assert.deepEqual(evidenceWindow(59_800, camera), { startMs: 56_800, endMs: 60_000 });
});
