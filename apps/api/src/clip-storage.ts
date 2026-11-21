import { execFile } from 'node:child_process';
import { mkdir, open, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { maxClipBytes, maxClipMiB } from '@sensewell/contracts';

const runMediaCommand = promisify(execFile);
const contextMs = 3000;

export function evidenceWindow(sourceMs: number, camera: { startOffsetMs: number; durationMs: number }) {
  return {
    startMs: Math.max(camera.startOffsetMs, sourceMs - contextMs),
    endMs: Math.min(camera.durationMs, sourceMs + contextMs),
  };
}

export const clipInput = {
  flags: ['-protocol_whitelist', 'file', '-f', 'mov'],
  videoStream: 'V:0',
};

@Injectable()
export class ClipStorage {
  private evidenceEncodes = 0;
  private readonly root = process.env.CLIP_STORAGE_DIR ?? '.sensewell-clips';

  path(cameraId: string) {
    return join(this.root, `${cameraId}.mp4`);
  }

  async save(cameraId: string, payload: Readable) {
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const path = this.path(cameraId);
    const file = await open(path, 'wx', 0o600);
    let size = 0;
    try {
      await pipeline(payload, async function* (chunks) {
        for await (const chunk of chunks) {
          size += chunk.length;
          if (size > maxClipBytes) throw new PayloadTooLargeException(`Choose a clip up to ${maxClipMiB} MiB.`);
          yield chunk;
        }
      }, file.createWriteStream());
      return await this.probeTimeline(path);
    } catch (error) {
      await this.discard(cameraId);
      throw error;
    }
  }

  async discard(cameraId: string) {
    await unlink(this.path(cameraId)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error;
    });
  }

  async open(cameraId: string) {
    try {
      return await open(this.path(cameraId), 'r');
    } catch {
      throw new ServiceUnavailableException('The source clip is unavailable.');
    }
  }

  async evidenceClip(cameraId: string, { startMs, endMs }: ReturnType<typeof evidenceWindow>, signal: AbortSignal) {
    if (this.evidenceEncodes >= 2) throw new ServiceUnavailableException('Evidence clip processing is busy. Try again shortly.');
    this.evidenceEncodes += 1;
    try {
      const { stdout } = await runMediaCommand('ffmpeg', [
        '-nostdin', '-v', 'error', '-xerror', '-threads', '2', '-filter_threads', '1',
        ...clipInput.flags, '-ss', String(startMs / 1000), '-i', this.path(cameraId),
        '-t', String((endMs - startMs) / 1000), '-map', `0:${clipInput.videoStream}`, '-map', '0:a:0?',
        '-vf', "scale=w='min(960,iw)':h='min(540,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-threads', '2',
        '-fpsmax', '30', '-g', '30', '-maxrate', '4M', '-bufsize', '2M',
        '-c:a', 'aac', '-b:a', '96k', '-movflags', '+frag_keyframe+empty_moov+default_base_moof',
        '-f', 'mp4', 'pipe:1',
      ], { timeout: 10_000, maxBuffer: 8 * 1024 * 1024, encoding: 'buffer', signal });
      if (!stdout.length) throw new Error('Empty evidence clip');
      return stdout;
    } catch {
      throw new ServiceUnavailableException('The evidence clip is unavailable.');
    } finally {
      this.evidenceEncodes -= 1;
    }
  }

  private async probeTimeline(path: string) {
    const probeOptions = { timeout: 15_000, maxBuffer: 64 * 1024 };
    try {
      const { stdout } = await runMediaCommand('ffprobe', [
        '-v', 'error', ...clipInput.flags, '-select_streams', clipInput.videoStream,
        '-show_entries', 'stream=codec_name,pix_fmt,duration,start_time:format=start_time',
        '-of', 'json', path,
      ], probeOptions);
      const { streams, format } = JSON.parse(stdout) as {
        streams?: { codec_name: string; pix_fmt: string; duration: string; start_time: string }[];
        format?: { start_time: string };
      };
      const video = streams?.[0];
      if (video?.codec_name !== 'h264' || !['yuv420p', 'yuvj420p'].includes(video.pix_fmt)) {
        throw new Error('Unsupported clip format');
      }
      const videoDurationMs = Math.round(Number(video.duration) * 1000);
      const startOffsetMs = Math.max(0, Math.round((Number(video.start_time) - Number(format?.start_time)) * 1000));
      const durationMs = startOffsetMs + videoDurationMs;
      if (!Number.isInteger(durationMs) || videoDurationMs < 1 || durationMs > 2_147_483_647) {
        throw new Error('Invalid clip timeline');
      }

      const { stdout: frameHash } = await runMediaCommand('ffmpeg', [
        '-nostdin', '-v', 'error', '-xerror', '-threads', '2', ...clipInput.flags, '-i', path,
        '-map', `0:${clipInput.videoStream}`, '-frames:v', '1', '-f', 'framehash', 'pipe:1',
      ], probeOptions);
      if (!/^0,/m.test(frameHash)) throw new Error('No decodable video frame');
      return { startOffsetMs, durationMs };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new ServiceUnavailableException('The clip reader is unavailable.');
      }
      throw new BadRequestException('Choose a playable H.264 MP4 clip.');
    }
  }
}
