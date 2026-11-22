import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { BadRequestException, ConflictException, Injectable, Logger, ServiceUnavailableException, type OnModuleDestroy } from '@nestjs/common';
import type { ReplayFrameAnalysis, ReplayGroupTrackOptions, ReplayImage, ReplayStatus, SyntheticCamera } from '@sensewell/contracts';
import { ClipStorage } from './clip-storage.js';
import { DatabaseService } from './database.service.js';
import { detectObjects, replayDisplayDelayMs } from './replay-detector.js';
import { jpegPart, replayFrameIntervalMs, replayFrames, type ReplayFrame } from './replay-source.js';
import { ZoneEntryEvaluator } from './zone-entry.js';

type DisplayedFrame = ReplayFrame & Omit<ReplayImage, 'jpeg'>;

interface ReplayView {
  status: ReplayStatus;
  frame?: DisplayedFrame;
}

interface Replay extends ReplayView {
  abort: AbortController;
  ready: Promise<void>;
  task: Promise<void>;
  passId?: string;
}

type ReplayCamera = SyntheticCamera & { startOffsetMs: number };
type ReplayTrack = ReplayGroupTrackOptions & { camera: ReplayCamera };

interface ReplayClock {
  monotonicStart: number;
  utcStart: number;
  analysisTail: Promise<void>;
}

const replayCapacity = 4;
const decoderLeadMs = 250;
const groupedDetectorTimeoutMs = 1500;
const lateFrameGraceMs = 2500;

@Injectable()
export class ReplayService implements OnModuleDestroy {
  private readonly logger = new Logger(ReplayService.name);
  private readonly active = new Map<string, Replay>();
  private readonly completed = new Map<string, ReplayView>();

  constructor(private readonly clips: ClipStorage, private readonly database: DatabaseService) {}

  status(cameraId: string): ReplayStatus {
    return this.active.get(cameraId)?.status ?? this.completed.get(cameraId)?.status ?? { state: 'idle' };
  }

  isPassActive(cameraId: string, passId: string) {
    return this.active.get(cameraId)?.passId === passId;
  }

  async start(tenantId: string, camera: ReplayCamera, loop: boolean) {
    const existing = this.active.get(camera.id);
    if (existing) return this.startedStatus(existing);
    this.checkCapacity(1);

    const runId = randomUUID();
    const ready = this.database.cameras.recordPass(tenantId, { cameraId: camera.id, id: runId, runId, passNumber: 1 });
    return this.startedStatus(this.reserve(tenantId, camera, loop, runId, runId, ready));
  }

  async startGroup(tenantId: string, tracks: ReplayTrack[], bufferMs: number) {
    const durationMs = tracks[0]?.camera.durationMs;
    if (durationMs === undefined || tracks.some(({ camera, gap }) =>
      camera.startOffsetMs !== 0 || camera.durationMs !== durationMs || (gap && gap.endMs > durationMs))) {
      throw new BadRequestException('Group recordings must start at zero, share a duration, and contain any configured gaps.');
    }
    if (tracks.some(({ camera }) => this.active.has(camera.id))) {
      throw new ConflictException('A group camera is already replaying.');
    }
    this.checkCapacity(tracks.length);
    const runId = randomUUID();
    const entries = tracks.map((track) => ({
      track, pass: { cameraId: track.camera.id, id: randomUUID(), runId, passNumber: 1 },
    }));
    const passes = entries.map(({ pass }) => pass);
    const clock = this.database.cameras.recordPasses(tenantId, passes).then((): ReplayClock => ({
      monotonicStart: performance.now() + decoderLeadMs,
      utcStart: Date.now() + decoderLeadMs,
      analysisTail: Promise.resolve(),
    }));
    const ready = clock.then(() => undefined);
    for (const { track, pass } of entries) {
      this.reserve(tenantId, track.camera, false, runId, pass.id, ready, { clock, bufferMs, track });
    }
    const { utcStart } = await clock.catch(() => {
      throw new ServiceUnavailableException('Could not start replay. Try again shortly.');
    });
    return {
      runId, startedAt: new Date(utcStart).toISOString(),
      passes: passes.map(({ cameraId, id }) => ({ cameraId, passId: id })),
    };
  }

  private checkCapacity(count: number) {
    if (this.active.size + count > replayCapacity) {
      throw new ServiceUnavailableException('Replay is at capacity. Try again shortly.');
    }
  }

  private reserve(
    tenantId: string, camera: ReplayCamera, loop: boolean, runId: string, passId: string,
    ready: Promise<void>,
    group?: { clock: Promise<ReplayClock>; bufferMs: number; track: ReplayGroupTrackOptions },
  ) {
    const replay: Replay = {
      abort: new AbortController(),
      status: { state: 'starting' },
      ready,
      passId,
      task: Promise.resolve(),
    };
    this.active.set(camera.id, replay);
    this.completed.delete(camera.id);
    replay.task = this.run(tenantId, camera, loop, runId, passId, replay, group);
    return replay;
  }

  private async startedStatus(replay: Replay) {
    await replay.ready.catch(() => {
      throw new ServiceUnavailableException('Could not start replay. Try again shortly.');
    });
    return replay.status;
  }

  async stop(cameraId: string, passId?: string) {
    const replay = this.active.get(cameraId);
    if (replay && (!passId || replay.passId === passId)) {
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

  private async run(
    tenantId: string, camera: ReplayCamera, loop: boolean, runId: string, firstPassId: string, replay: Replay,
    group?: { clock: Promise<ReplayClock>; bufferMs: number; track: ReplayGroupTrackOptions },
  ) {
    const signal = replay.abort.signal;
    let result: ReplayStatus = { state: 'idle' };
    let pendingAnalysis: Promise<void> | undefined;
    let lastDisplay: Promise<void> | undefined;
    const totalFrames = Math.ceil((camera.durationMs - camera.startOffsetMs) / replayFrameIntervalMs);
    try {
      await replay.ready;
      const clock = await group?.clock;
      const delayMs = group?.track.delayMs ?? 0;
      const gap = group?.track.gap;
      const displayLagMs = Math.max(group?.bufferMs ?? 0, delayMs ? delayMs + lateFrameGraceMs : replayDisplayDelayMs);
      let passNumber = 0;
      do {
        const currentPass = ++passNumber;
        const passId = currentPass === 1 ? firstPassId : randomUUID();
        let analyzedFrames = 0;
        const zoneEntries = new ZoneEntryEvaluator();
        if (currentPass > 1) {
          await this.database.cameras.recordPass(tenantId, { cameraId: camera.id, id: passId, runId, passNumber: currentPass });
          replay.passId = passId;
        }
        signal.throwIfAborted();

        for await (const frame of replayFrames(this.clips.path(camera.id), {
          cameraId: camera.id, passId,
        }, camera, signal, clock && clock.monotonicStart + delayMs)) {
          const isGap = gap && frame.sourceMs >= gap.startMs && frame.sourceMs < gap.endMs;
          let analysis: ReplayFrameAnalysis = { state: 'skipped' };
          if (isGap) {
            analysis = { state: 'unavailable' };
          } else if (!pendingAnalysis) {
            analysis = { state: 'delayed' };
            // The detector services one request at a time. Give every ready camera
            // a turn, with at most one outstanding frame per camera.
            const analysisTask = clock
              ? clock.analysisTail.then(() => signal.aborted
                ? { state: 'unavailable' } as const
                : detectObjects(frame.jpeg, signal, groupedDetectorTimeoutMs))
              : this.analyze(tenantId, frame, currentPass, zoneEntries, signal);
            if (clock) clock.analysisTail = analysisTask.then(() => undefined, () => undefined);
            pendingAnalysis = analysisTask.then((result) => {
              analysis = result;
              if (!clock && result.state === 'analyzed') analyzedFrames += 1;
            }).finally(() => { pendingAnalysis = undefined; });
          }

          // Release frames in source order at 1×, with time for inference on each exact image.
          const displayWait = clock
            ? clock.monotonicStart + frame.sourceMs + displayLagMs - performance.now()
            : replayDisplayDelayMs;
          const priorDisplay = lastDisplay;
          lastDisplay = setTimeout(displayWait, undefined, { signal }).then(async () => {
            if (clock) {
              await priorDisplay;
              if (signal.aborted) return;
              if (analysis.state === 'analyzed') {
                const occurredAt = new Date(clock.utcStart + frame.sourceMs);
                analysis = await this.recordAnalysis(tenantId, frame, currentPass, zoneEntries, signal, occurredAt, analysis);
                if (analysis.state === 'analyzed') analyzedFrames += 1;
              } else if (analysis.state !== 'skipped') {
                zoneEntries.interrupt();
              }
            }
            if (signal.aborted) return;
            replay.frame = { ...frame, passNumber: currentPass, analysis, analyzedFrames, totalFrames };
            replay.status = { state: 'running', passId, passNumber: currentPass, sourceMs: frame.sourceMs };
          }, () => undefined);
        }
        await pendingAnalysis;
        if (loop) replay.passId = undefined;
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
      await lastDisplay;
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
    frame: ReplayFrame,
    passNumber: number,
    zoneEntries: ZoneEntryEvaluator,
    signal: AbortSignal,
  ) {
    const occurredAt = new Date();
    const result = await detectObjects(frame.jpeg, signal);
    return this.recordAnalysis(tenantId, frame, passNumber, zoneEntries, signal, occurredAt, result);
  }

  private async recordAnalysis(
    tenantId: string,
    { jpeg, cameraId, passId, sourceMs }: ReplayFrame,
    passNumber: number,
    zoneEntries: ZoneEntryEvaluator,
    signal: AbortSignal,
    occurredAt: Date,
    result: ReplayFrameAnalysis,
  ) {
    if (result.state !== 'analyzed') zoneEntries.interrupt();
    if (result.state === 'analyzed' && !signal.aborted) {
      const { detections } = result;
      const restore = zoneEntries.checkpoint();
      try {
        const saved = await this.database.observations.recordForReplay(
          tenantId, { cameraId, passId, passNumber, sourceMs, detections, occurredAt, jpeg },
          (rules) => {
            const { crossings, evidence } = zoneEntries.evaluate(sourceMs, detections, rules);
            return {
              evidence,
              crossings: crossings.map(({ rule, detection, direction, ground }) => ({
                rule, direction, ground, detectionIndex: detections.indexOf(detection),
              })),
            };
          },
        );
        if (!saved) restore();
      } catch {
        restore();
        zoneEntries.interrupt();
        this.logger.warn(`Could not record an observation for replay pass ${passId}`);
        return { state: 'unavailable' } as const;
      }
    }
    return result;
  }
}
