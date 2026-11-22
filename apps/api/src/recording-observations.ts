import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { setTimeout } from 'node:timers/promises';
import type { RecordingObservation } from '@sensewell/contracts';
import { jpegFrames } from './jpeg-stream.js';
import { detectObjects } from './replay-detector.js';

export async function observeRecording(path: string, signal: AbortSignal): Promise<RecordingObservation[]> {
  const decodeSignal = AbortSignal.any([signal, AbortSignal.timeout(15_000)]);
  const decoder = spawn('ffmpeg', [
    '-nostdin', '-nostats', '-loglevel', 'info', '-xerror', '-threads', '2', '-filter_threads', '1',
    '-protocol_whitelist', 'file', '-f', 'mov', '-i', path,
    '-map', '0:V:0', '-vf', [
      'setpts=PTS-STARTPTS',
      "select='isnan(prev_selected_t)+gte(t-prev_selected_t,0.19)'",
      'showinfo',
      "scale=w='min(960,iw)':h='min(540,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    ].join(','),
    '-fps_mode', 'passthrough', '-c:v', 'mjpeg', '-threads', '1', '-f', 'mpjpeg', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'pipe'], signal: decodeSignal });

  const closed = new Promise<boolean>((resolve) => {
    decoder.on('error', () => { /* The close event follows an error. */ });
    decoder.once('close', (code) => resolve(code === 0));
  });
  const offsets: number[] = [];
  const jpegs: Buffer[] = [];
  const lines = createInterface({ input: decoder.stderr, crlfDelay: Infinity });
  try {
    const results = await Promise.allSettled([
      (async () => {
        for await (const line of lines) {
          const timestamp = /Parsed_showinfo_.*\bn:\s*\d+\s+pts:\s*\d+\s+pts_time:([\d.e+-]+)/.exec(line);
          if (timestamp) offsets.push(Math.round(Number(timestamp[1]) * 1000));
        }
      })(),
      (async () => {
        for await (const jpeg of jpegFrames(decoder.stdout)) jpegs.push(jpeg);
      })(),
      closed,
    ]);
    signal.throwIfAborted();
    if (results.some((result) => result.status === 'rejected') ||
        results[2].status !== 'fulfilled' || !results[2].value || offsets.length !== jpegs.length) return [];
  } finally {
    lines.close();
    if (decoder.exitCode === null && decoder.signalCode === null) decoder.kill('SIGKILL');
  }

  const frames: RecordingObservation[] = [];
  for (const [index, jpeg] of jpegs.entries()) {
    signal.throwIfAborted();
    let frame = await detectObjects(jpeg, signal, 1500);
    for (let retry = 0; frame.state === 'skipped' && retry < 4; retry++) {
      await setTimeout(50, undefined, { signal });
      frame = await detectObjects(jpeg, signal, 1500);
    }
    frames.push({ offsetMs: offsets[index]!, detections: frame.state === 'analyzed' ? frame.detections : null });
    // A detector outage leaves the remainder of the segment without observations.
    if (frames.length === 3 && frames.every(({ detections }) => detections === null) && frame.state === 'unavailable') break;
  }
  return frames;
}
