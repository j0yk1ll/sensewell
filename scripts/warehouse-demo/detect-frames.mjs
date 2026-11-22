import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { detectObjects } from '../../apps/api/dist/replay-detector.js';
import { jpegFrames } from '../../apps/api/dist/replay-source.js';

const [clip, start, end] = process.argv.slice(2);
if (!clip || !process.env.REPLAY_DETECTOR_URL || !(Number(start) >= 0 && Number(end) > Number(start))) {
  throw new Error('Set REPLAY_DETECTOR_URL and pass the clip, start seconds and end seconds.');
}
const abort = new globalThis.AbortController();
const decoder = spawn('ffmpeg', [
  '-nostdin', '-v', 'error', '-xerror', '-threads', '2', '-filter_threads', '1',
  '-ss', start, '-i', clip, '-t', String(Number(end) - Number(start)), '-map', '0:v:0',
  '-vf', "setpts=PTS-STARTPTS,fps=10:start_time=0:round=up,scale=w='min(960,iw)':h='min(540,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
  '-c:v', 'mjpeg', '-threads', '1', '-f', 'mpjpeg', 'pipe:1',
], { signal: abort.signal, stdio: ['ignore', 'pipe', 'inherit'] });
const done = once(decoder, 'close');
let sourceMs = Math.round(Number(start) * 1000);
try {
  for await (const jpeg of jpegFrames(decoder.stdout)) {
    const analysis = await detectObjects(jpeg, abort.signal, 5000);
    if (analysis.state !== 'analyzed') throw new Error(`Detector returned ${analysis.state} at ${sourceMs} ms.`);
    process.stdout.write(JSON.stringify({ sourceMs, detections: analysis.detections }) + '\n');
    sourceMs += 100;
  }
  const [code] = await done;
  if (code || sourceMs !== Math.round(Number(end) * 1000)) throw new Error('The decoder did not produce the requested time range.');
} finally {
  if (decoder.exitCode === null) abort.abort();
}
