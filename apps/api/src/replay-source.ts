import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import type { Readable } from 'node:stream';
import { clipInput } from './clip-storage.js';

const framesPerSecond = 10;
const frameIntervalMs = 1000 / framesPerSecond;

export interface ReplayFrame {
  cameraId: string;
  passId: string;
  sourceMs: number;
  jpeg: Buffer;
}

async function* jpegFrames(stream: Readable) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        if (buffer.length > 256) throw new Error('Invalid frame header');
        break;
      }
      const header = buffer.toString('ascii', 0, headerEnd);
      const length = Number(/\r\ncontent-length: (\d+)/i.exec(header)?.[1]);
      if (!Number.isInteger(length) || length < 1 || length > 1024 * 1024) {
        throw new Error('Invalid frame length');
      }
      const start = headerEnd + 4;
      const end = start + length;
      if (buffer.length < end) break;
      yield buffer.subarray(start, end);
      buffer = buffer.subarray(end);
    }
  }
}

// Each pass follows the clip timeline. Backpressure limits decode-ahead.
export async function* replayFrames(
  path: string,
  pass: Pick<ReplayFrame, 'cameraId' | 'passId'>,
  { startOffsetMs, durationMs }: { startOffsetMs: number; durationMs: number },
  signal: AbortSignal,
): AsyncGenerator<ReplayFrame> {
  const decoder = spawn('ffmpeg', [
    '-nostdin', '-v', 'error', '-xerror', '-threads', '2', '-filter_threads', '1',
    ...clipInput.flags, '-i', path, '-t', String((durationMs - startOffsetMs) / 1000),
    '-map', `0:${clipInput.videoStream}`, '-vf', [
      'setpts=PTS-STARTPTS',
      `fps=${framesPerSecond}:start_time=0:round=up`,
      "scale=w='min(960,iw)':h='min(540,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    ].join(','),
    '-c:v', 'mjpeg', '-threads', '1', '-f', 'mpjpeg', 'pipe:1',
  ], { stdio: ['ignore', 'pipe', 'ignore'], signal, killSignal: 'SIGKILL' });

  const exited = new Promise<boolean>((resolve) => {
    decoder.once('error', () => resolve(false));
    decoder.once('close', (code) => resolve(code === 0));
  });
  let sourceMs = startOffsetMs;
  let startedAt: number | undefined;

  try {
    for await (const jpeg of jpegFrames(decoder.stdout)) {
      signal.throwIfAborted();
      if (sourceMs >= durationMs) continue;
      startedAt ??= performance.now();
      const wait = startedAt + sourceMs - performance.now();
      if (wait > 0) await setTimeout(wait, undefined, { signal });
      yield { ...pass, sourceMs, jpeg };
      sourceMs += frameIntervalMs;
    }

    if (!(await exited) || startedAt === undefined) throw new Error('No playable replay frames');
    const remaining = startedAt + durationMs - performance.now();
    if (remaining > 0) await setTimeout(remaining, undefined, { signal });
  } finally {
    if (decoder.exitCode === null && decoder.signalCode === null) decoder.kill('SIGKILL');
    await exited;
  }
}
