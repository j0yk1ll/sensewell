import { mkdir, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';
import { Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { CaptureStatus } from '@sensewell/contracts';
import { DatabaseService } from './database.service.js';
import { captureStream, publishSegment } from './ip-camera-capture.js';
import { decryptStream, isAllowedStream } from './ip-camera-source.js';
import { jpegPart } from './replay-source.js';

interface Capture {
  abort: AbortController;
  state: CaptureStatus['state'];
  jpeg?: Buffer;
  task: Promise<void>;
}

@Injectable()
export class IpCameraService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IpCameraService.name);
  private readonly root = process.env.RECORDING_STORAGE_DIR ?? '.sensewell-recordings';
  private readonly captures = new Map<string, Capture>();

  constructor(private readonly database: DatabaseService) {}

  async onModuleInit() {
    for await (const source of this.database.cameras.captureSources()) {
      if (!source.encryptedStream) continue;
      try {
        const stream = decryptStream(source.encryptedStream);
        if (isAllowedStream(stream)) this.start(source.tenantId, source.id, stream);
      } catch {
        this.logger.warn(`Could not restore stream for camera ${source.id}`);
      }
    }
  }

  async onModuleDestroy() {
    await Promise.all([...this.captures.keys()].map((id) => this.stop(id)));
  }

  status(id: string) {
    return { state: this.captures.get(id)?.state ?? 'unavailable' };
  }

  start(tenantId: string, id: string, stream: URL) {
    if (this.captures.has(id)) return;
    const capture: Capture = {
      abort: new AbortController(), state: 'connecting', task: Promise.resolve(),
    };
    this.captures.set(id, capture);
    capture.task = this.run(tenantId, id, stream, capture);
  }

  async stop(id: string) {
    const capture = this.captures.get(id);
    if (!capture) return;
    capture.abort.abort();
    await capture.task;
    this.captures.delete(id);
  }

  async open(cameraId: string, recordingId: string) {
    try {
      return await open(join(this.directory(cameraId), `${recordingId}.mp4`), 'r');
    } catch {
      throw new ServiceUnavailableException('The recording is unavailable.');
    }
  }

  async *video(id: string, signal: AbortSignal) {
    const capture = this.captures.get(id);
    let previous: Buffer | undefined;
    while (capture?.state === 'connected' && !capture.abort.signal.aborted && !signal.aborted) {
      if (capture.jpeg && capture.jpeg !== previous) {
        previous = capture.jpeg;
        yield jpegPart(previous);
      }
      await setTimeout(100, undefined, { signal }).catch(() => undefined);
    }
    if (!signal.aborted) yield Buffer.from('--frame--\r\n');
  }

  private directory(id: string) {
    return join(this.root, id);
  }

  private async run(tenantId: string, id: string, stream: URL, capture: Capture) {
    const directory = this.directory(id);
    const signal = capture.abort.signal;
    while (!signal.aborted) {
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await captureStream(stream, directory, signal, (jpeg) => {
          capture.jpeg = jpeg;
          capture.state = jpeg ? 'connected' : 'unavailable';
        }, async (segment) => {
          const { path, ...recording } = await publishSegment(directory, segment);
          try {
            await this.database.recordings.add(tenantId, { ...recording, cameraId: id });
          } catch (error) {
            await rm(path, { force: true });
            throw error;
          }
        });
      } catch {
        if (!signal.aborted) this.logger.warn(`Capture failed for camera ${id}`);
      }

      capture.jpeg = undefined;
      capture.state = 'unavailable';
      await setTimeout(2000, undefined, { signal }).catch(() => undefined);
    }
  }
}
