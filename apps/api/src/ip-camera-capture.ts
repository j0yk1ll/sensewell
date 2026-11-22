import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable } from 'node:stream';
import { jpegFrames } from './jpeg-stream.js';

interface RecordedSegment {
  path: string;
  startedAt: Date;
  endedAt: Date;
}

export async function captureStream(
  url: URL,
  directory: string,
  signal: AbortSignal,
  showFrame: (jpeg?: Buffer) => void,
  saveSegment: (segment: RecordedSegment) => Promise<void>,
) {
  const scratch = await mkdtemp(join(directory, 'capture-'));
  try {
    signal.throwIfAborted();
    await captureAttempt();
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }

  async function captureAttempt() {
    const input = url.username && !url.password ? url.href.replace('@', ':@') : url.href;
    // Use a single input connection for the recording and live preview.
    const capture = spawn('ffmpeg', [
      '-nostdin', '-loglevel', 'error', '-threads', '2', '-filter_threads', '1',
      '-protocol_whitelist', 'tcp', '-f', 'rtsp', '-rtsp_transport', 'tcp',
      '-allowed_media_types', 'video', '-analyzeduration', '1000000', '-timeout', '4000000', '-i', input,
      '-map', '0:V:0', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-pix_fmt', 'yuv420p',
      '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-tune', 'zerolatency',
      '-fps_mode', 'passthrough', '-force_key_frames', 'expr:gte(t,n_forced*5)',
      '-f', 'segment', '-segment_time', '5', '-reset_timestamps', '1',
      '-segment_list_type', 'csv', '-segment_list', 'pipe:3',
      '-segment_format_options', 'movflags=+faststart', 'part-%09d.mp4',
      '-map', '0:V:0', '-vf', "fps=5,scale=w='min(960,iw)':h='min(540,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-c:v', 'mjpeg', '-threads', '1', '-f', 'mpjpeg', 'pipe:1',
    ], { cwd: scratch, stdio: ['ignore', 'pipe', 'ignore', 'pipe'] });

    const closed = new Promise<void>((resolve) => {
      capture.once('error', () => { /* The close event follows a spawn error. */ });
      capture.once('close', () => resolve());
    });

    let forceStop: NodeJS.Timeout | undefined;
    function stop() {
      if (forceStop || !capture.pid) return;
      showFrame();
      capture.kill('SIGTERM');
      forceStop = setTimeout(() => capture.kill('SIGKILL'), 6000);
    }

    let lastFrameAt = performance.now();
    // If an open connection stops delivering video, finalize this attempt so its gap stays visible.
    const watchdog = setInterval(() => {
      if (performance.now() - lastFrameAt > (startedAt === undefined ? 12_000 : 2000)) stop();
    }, 250);
    signal.addEventListener('abort', stop, { once: true });
    let startedAt: number | undefined;

    async function preview() {
      for await (const jpeg of jpegFrames(capture.stdout!)) {
        startedAt ??= Date.now();
        lastFrameAt = performance.now();
        if (!signal.aborted && !forceStop) showFrame(jpeg);
      }
    }

    async function record() {
      const lines = createInterface({ input: capture.stdio[3] as Readable, crlfDelay: Infinity });
      for await (const line of lines) {
        const entry = /^(part-\d+\.mp4),(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)$/.exec(line);
        if (!entry || startedAt === undefined) continue;
        const [, filename, start, end] = entry;
        if (!filename) continue;
        const from = startedAt + Math.round(Number(start) * 1000);
        const to = startedAt + Math.round(Number(end) * 1000);
        if (!Number.isSafeInteger(to) || to <= from) continue;
        await saveSegment({ path: join(scratch, filename), startedAt: new Date(from), endedAt: new Date(to) });
      }
    }

    try {
      const tasks = [preview(), record()].map((task) => task.catch((error: unknown) => {
        stop();
        throw error;
      }));
      const results = await Promise.allSettled(tasks);
      const failed = results.find((result) => result.status === 'rejected');
      if (failed) throw failed.reason;
    } finally {
      stop();
      await closed;
      clearInterval(watchdog);
      clearTimeout(forceStop);
      signal.removeEventListener('abort', stop);
    }
  }
}

export async function publishSegment(directory: string, segment: RecordedSegment) {
  const id = randomUUID();
  const path = join(directory, `${id}.mp4`);
  await rename(segment.path, path);
  return { id, path, startedAt: segment.startedAt, endedAt: segment.endedAt };
}
