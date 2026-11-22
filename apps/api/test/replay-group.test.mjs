import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import test from 'node:test';

test('a replay group uses one 1× source clock through analysis, including delays and gaps', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'sensewell-replay-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const clip = join(directory, 'clip.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=s=64x64:r=10',
    '-t', '1.6', '-c:v', 'libx264', '-threads', '1', clip]);

  const detector = createServer({ allowHalfOpen: true }, (socket) => {
    socket.resume();
    socket.on('end', () => socket.end(JSON.stringify({ state: 'analyzed', detections: [] })));
  });
  await new Promise((resolve, reject) => detector.listen(0, '127.0.0.1', resolve).once('error', reject));
  t.after(() => detector.close());
  process.env.REPLAY_DETECTOR_URL = `tcp://127.0.0.1:${detector.address().port}`;
  const { ReplayService } = await import('../dist/replay.service.js');
  const observations = [];
  const service = new ReplayService({ path: () => clip }, {
    cameras: { recordPasses: async () => {} },
    observations: { recordForReplay: async (_tenant, frame) => {
      observations.push({ ...frame, receivedAt: Date.now() });
      return true;
    } },
  });
  t.after(() => service.onModuleDestroy());
  const tracks = ['staging', 'aisle', 'dispatch'].map((id) => ({
    camera: { id, name: id, durationMs: 1600, startOffsetMs: 0 },
  }));
  tracks[1].delayMs = 900;
  tracks[2].gap = { startMs: 300, endMs: 900 };
  const { startedAt, passes } = await service.startGroup('tenant', tracks, 650);
  await assert.rejects(service.startGroup('tenant', tracks, 650), /already replaying/i);
  await service.stop('aisle', passes[0].passId);
  assert.equal(service.status('aisle').state, 'starting');

  const streams = await Promise.all(tracks.map(async ({ camera }) => {
    const frames = [];
    for await (const line of service.images(camera.id, globalThis.AbortSignal.timeout(7000))) {
      frames.push(JSON.parse(line));
    }
    return frames;
  }));
  assert.equal(new Set(passes.map(({ passId }) => passId)).size, 3);
  assert.deepEqual(streams.map((frames) => frames.at(-1).sourceMs), [1500, 1500, 1500]);
  assert.ok(streams[2].some(({ sourceMs, analysis }) => sourceMs >= 300 && sourceMs < 900 &&
    analysis.state === 'unavailable'));
  assert.ok(observations.some(({ cameraId }) => cameraId === 'dispatch'));
  assert.ok(!observations.some(({ cameraId, sourceMs }) => cameraId === 'dispatch' && sourceMs >= 300 && sourceMs < 900));
  const atZero = tracks.map(({ camera }) => observations.find(({ cameraId, sourceMs }) => cameraId === camera.id && sourceMs === 0));
  assert.ok(atZero.every(Boolean));
  assert.ok(atZero.every(({ occurredAt }) => occurredAt.toISOString() === startedAt));
  assert.ok(atZero[0].receivedAt >= Date.parse(startedAt) + 625);
  assert.ok(atZero[1].receivedAt - atZero[0].receivedAt >= 600);
  const laterStaging = observations.find(({ cameraId, sourceMs }) => cameraId === 'staging' && sourceMs >= 1200);
  assert.ok(laterStaging.receivedAt - atZero[0].receivedAt >= 1000);
  assert.ok(observations.some(({ cameraId, sourceMs, occurredAt }) => cameraId === 'aisle' && sourceMs >= 1000
    && occurredAt.getTime() === Date.parse(startedAt) + sourceMs));
});
