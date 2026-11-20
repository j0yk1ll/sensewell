import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import type { ReplayFrameAnalysis, ReplayImage, ReplayStatus, SyntheticCamera } from '@sensewell/contracts';
import { ClipStorage } from './clip-storage.js';
import { DatabaseService } from './database.service.js';
import { detectPeople, replayDisplayDelayMs } from './replay-detector.js';
import { jpegPart, replayFrameIntervalMs, replayFrames, type ReplayFrame } from './replay-source.js';
import { ZoneEntryEvaluator } from './zone-entry.js';

type DisplayedFrame = ReplayFrame & Omit<ReplayImage, 'jpeg'>;

interface ReplayView {
  status: ReplayStatus;
  frame?: DisplayedFrame;
}

interface Replay extends ReplayView {
  abort: AbortController;
  task: Promise<void>;
}

type ReplayCamera = SyntheticCamera & { startOffsetMs: number };

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
    for await (const { jpeg } of this.displayedFrames(cameraId, signal)) yield jpegPart(jpeg);
    if (!signal.aborted) yield Buffer.from('--frame--\r\n');
  }

  async *images(cameraId: string, signal: AbortSignal) {
    for await (const frame of this.displayedFrames(cameraId, signal)) {
      const { passId, passNumber, sourceMs, jpeg, analysis, analyzedFrames, totalFrames } = frame;
      const image: ReplayImage = {
        passId, passNumber, sourceMs, jpeg: jpeg.toString('base64'), analysis, analyzedFrames, totalFrames,
      };
      yield JSON.stringify(image) + '\n';
    }
  }

  private async *displayedFrames(cameraId: string, signal: AbortSignal) {
    const replay = this.active.get(cameraId);
    let previous: DisplayedFrame | undefined;
    while (replay && !signal.aborted && !replay.abort.signal.aborted && this.active.get(cameraId) === replay) {
      const frame = replay.frame;
      if (frame && frame !== previous) {
        previous = frame;
        yield frame;
      }
      await setTimeout(40, undefined, { signal }).catch(() => undefined);
    }
    const last = replay
      ? replay.status.state === 'finished' ? replay.frame : undefined
      : this.completed.get(cameraId)?.frame;
    if (!signal.aborted && last && last !== previous) yield last;
  }

  async onModuleDestroy() {
    await Promise.all([...this.active.keys()].map((id) => this.stop(id)));
  }

  private async run(tenantId: string, camera: ReplayCamera, loop: boolean, replay: Replay) {
    const signal = replay.abort.signal;
    let result: ReplayStatus = { state: 'idle' };
    let pendingAnalysis: Promise<void> | undefined;
    let lastDisplay: Promise<void> | undefined;
    const totalFrames = Math.ceil((camera.durationMs - camera.startOffsetMs) / replayFrameIntervalMs);
    try {
      let passNumber = 0;
      do {
        const passId = randomUUID();
        const currentPass = ++passNumber;
        let analyzedFrames = 0;
        const zoneEntries = new ZoneEntryEvaluator();
        await this.database.cameras.recordPass(tenantId, { cameraId: camera.id, id: passId });
        signal.throwIfAborted();

        for await (const frame of replayFrames(this.clips.path(camera.id), {
          cameraId: camera.id, passId,
        }, camera, signal)) {
          let analysis: ReplayFrameAnalysis = { state: 'skipped' };
          if (!pendingAnalysis) {
            analysis = { state: 'delayed' };
            pendingAnalysis = this.analyze(tenantId, frame, currentPass, zoneEntries, signal).then((result) => {
              analysis = result;
              if (result.state === 'analyzed') analyzedFrames += 1;
            }).finally(() => { pendingAnalysis = undefined; });
          }

          // Release frames in source order at 1×, with time for inference on each exact image.
          lastDisplay = setTimeout(replayDisplayDelayMs, undefined, { signal }).then(() => {
            replay.frame = { ...frame, passNumber: currentPass, analysis, analyzedFrames, totalFrames };
            replay.status = { state: 'running', passId, passNumber: currentPass, sourceMs: frame.sourceMs };
          }, () => undefined);
        }
      } while (loop && !signal.aborted);
      await lastDisplay;
      if (!signal.aborted) result = { state: 'finished' };
    } catch {
      if (!signal.aborted) {
        this.logger.warn(`Replay failed for camera ${camera.id}`);
        result = { state: 'unavailable' };
      }
    } finally {
      if (result.state !== 'finished') replay.abort.abort();
      await pendingAnalysis;
      replay.status = result;
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

  private async analyze(
    tenantId: string,
    { jpeg, cameraId, passId, sourceMs }: ReplayFrame,
    passNumber: number,
    zoneEntries: ZoneEntryEvaluator,
    signal: AbortSignal,
  ) {
    const occurredAt = new Date();
    const result = await detectPeople(jpeg, signal);
    if (result.state === 'analyzed' && !signal.aborted) {
      const { people } = result;
      try {
        await this.database.observations.recordForReplay(
          tenantId, { cameraId, passId, passNumber, sourceMs, people, occurredAt, jpeg },
          (rules) => zoneEntries.observe(sourceMs, people, rules)
            .map(({ rule, person, direction }) => ({ rule, direction, personIndex: people.indexOf(person) })),
        );
      } catch {
        zoneEntries.reset();
        this.logger.warn(`Could not record an observation for replay pass ${passId}`);
        return { state: 'unavailable' } as const;
      }
    }
    return result;
  }
}
