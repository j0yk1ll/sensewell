import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';
import { detectObjects } from '../../apps/api/dist/replay-detector.js';
import { jpegFrames, replayDecoderArgs, replayFrameIntervalMs } from '../../apps/api/dist/replay-source.js';

const [clip, start, end] = process.argv.slice(2);
const [startMs, endMs] = [start, end].map((seconds) => Number(seconds) * 1000);
const aligned = [startMs, endMs].every((ms) => ms % replayFrameIntervalMs === 0);
if (!clip || !process.env.REPLAY_DETECTOR_URL || !aligned || !(startMs >= 0 && endMs > startMs)) {
  throw new Error('Set REPLAY_DETECTOR_URL and pass the clip and start and end seconds aligned to replay frames.');
}
const abort = new globalThis.AbortController();
const decoder = spawn('ffmpeg', replayDecoderArgs(clip, endMs - startMs, startMs), {
  signal: abort.signal, stdio: ['ignore', 'pipe', 'inherit'],
});
const done = once(decoder, 'close');
let sourceMs = startMs;
try {
  for await (const jpeg of jpegFrames(decoder.stdout)) {
    const analysis = await detectObjects(jpeg, abort.signal, 5000);
    if (analysis.state !== 'analyzed') throw new Error(`Detector returned ${analysis.state} at ${sourceMs} ms.`);
    process.stdout.write(JSON.stringify({ sourceMs, detections: analysis.detections }) + '\n');
    sourceMs += replayFrameIntervalMs;
  }
  const [code] = await done;
  if (code || sourceMs !== endMs) throw new Error('The decoder did not produce the requested time range.');
} finally {
  if (decoder.exitCode === null) abort.abort();
}
