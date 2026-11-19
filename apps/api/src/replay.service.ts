import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import type { ReplayStatus, SyntheticCamera } from '@sensewell/contracts';
import { ClipStorage } from './clip-storage.js';
import { DatabaseService } from './database.service.js';
import { replayFrames, type ReplayFrame } from './replay-source.js';

interface ReplayView {
  status: ReplayStatus;
  frame?: ReplayFrame;
}

interface Replay extends ReplayView {
  abort: AbortController;
  task: Promise<void>;
}

type ReplayCamera = SyntheticCamera & { startOffsetMs: number };

function framePart(frame: ReplayFrame) {
  return Buffer.concat([
    Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.jpeg.length}\r\n\r\n`),
    frame.jpeg,
    Buffer.from('\r\n'),
  ]);
}

@Injectable()
export class ReplayService implements OnModuleDestroy {
  private readonly logger = new Logger(ReplayService.name);
  private readonly active = new Map<string, Replay>();
  private readonly completed = new Map<string, ReplayView>();

  constructor(private readonly clips: ClipStorage, private readonly database: DatabaseService) {}

  status(cameraId: string): ReplayStatus {
    return this.active.get(cameraId)?.status ?? this.completed.get(cameraId)?.status ?? { state: 'idle' };
  }

  start(tenantId: string, camera: ReplayCamera, loop: boolean) {
    if (this.active.has(camera.id)) return this.status(camera.id);
    if (this.active.size >= 4) throw new ServiceUnavailableException('Replay is at capacity. Try again shortly.');

    const replay: Replay = {
      abort: new AbortController(),
      status: { state: 'starting' },
      task: Promise.resolve(),
    };
    this.active.set(camera.id, replay);
    this.completed.delete(camera.id);
    replay.task = this.run(tenantId, camera, loop, replay);
    return replay.status;
  }

  async stop(cameraId: string) {
    const replay = this.active.get(cameraId);
    if (replay) {
      replay.status = { state: 'stopping' };
      replay.abort.abort();
      await replay.task;
    }
    return this.status(cameraId);
  }

  async *video(cameraId: string, signal: AbortSignal) {
    const replay = this.active.get(cameraId);
    let previous: ReplayFrame | undefined;
    while (replay && !signal.aborted && !replay.abort.signal.aborted && this.active.get(cameraId) === replay) {
      const frame = replay.frame;
      if (frame && frame !== previous) {
        previous = frame;
        yield framePart(frame);
      }
      await setTimeout(50, undefined, { signal }).catch(() => undefined);
    }
    const last = this.completed.get(cameraId)?.frame;
    if (!signal.aborted && last && last !== previous) yield framePart(last);
    if (!signal.aborted) yield Buffer.from('--frame--\r\n');
  }

  async onModuleDestroy() {
    await Promise.all([...this.active.keys()].map((id) => this.stop(id)));
  }

  private async run(tenantId: string, camera: ReplayCamera, loop: boolean, replay: Replay) {
    const signal = replay.abort.signal;
    let result: ReplayStatus = { state: 'idle' };
    try {
      let passNumber = 0;
      do {
        const passId = randomUUID();
        passNumber += 1;
        await this.database.cameras.recordPass(tenantId, { cameraId: camera.id, id: passId });
        signal.throwIfAborted();

        for await (const frame of replayFrames(this.clips.path(camera.id), {
          cameraId: camera.id, passId,
        }, camera, signal)) {
          replay.frame = frame;
          replay.status = { state: 'running', passId, passNumber, sourceMs: frame.sourceMs };
        }
      } while (loop && !signal.aborted);
      if (!signal.aborted) result = { state: 'finished' };
    } catch {
      if (!signal.aborted) {
        this.logger.warn(`Replay failed for camera ${camera.id}`);
        result = { state: 'unavailable' };
      }
    } finally {
      this.completed.set(camera.id, {
        status: result,
        frame: result.state === 'finished' ? replay.frame : undefined,
      });
      if (this.completed.size > 16) {
        const oldest = this.completed.keys().next().value;
        if (oldest !== undefined) this.completed.delete(oldest);
      }
      this.active.delete(camera.id);
    }
  }
}
