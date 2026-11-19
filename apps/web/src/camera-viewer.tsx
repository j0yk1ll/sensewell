import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReplayStatus, SyntheticCamera } from '@sensewell/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Slider } from '@/components/ui/slider';
import { cameraApi } from './camera-api';

const replayLabel = {
  idle: 'Ready to replay',
  starting: 'Starting replay…',
  running: 'Replay running',
  stopping: 'Stopping replay…',
  finished: 'Replay finished',
  unavailable: 'Replay unavailable',
};

function clock(milliseconds: number) {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function CameraViewer({ camera, tenantId }: { camera: SyntheticCamera; tenantId: string }) {
  const viewer = useRef<HTMLDivElement>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenError, setFullscreenError] = useState(false);
  const loopId = useId();
  const [loop, setLoop] = useState(false);
  const [keepLastFrame, setKeepLastFrame] = useState(false);
  const [replayVersion, setReplayVersion] = useState(0);
  const queryClient = useQueryClient();
  const queryKey = ['replay', tenantId, camera.id];
  const replay = useQuery({
    queryKey,
    queryFn: ({ signal }) => cameraApi.status(camera.id, signal),
    refetchInterval: (query) => query.state.data?.state === 'starting' || query.state.data?.state === 'running' ? 250 : 1000,
    retry: false,
  });
  const status = replay.data;
  const active = status?.state === 'starting' || status?.state === 'running' || status?.state === 'stopping';

  const showReplay = active || (keepLastFrame && status?.state === 'finished');

  useEffect(() => {
    function syncFullscreen() {
      setFullscreen(document.fullscreenElement === viewer.current);
    }
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);

  async function toggleFullscreen() {
    setFullscreenError(false);
    try {
      if (document.fullscreenElement === viewer.current) {
        await document.exitFullscreen();
      } else {
        await viewer.current?.requestFullscreen();
      }
    } catch {
      setFullscreenError(true);
    }
  }

  const action = useMutation({
    mutationFn: (command: 'start' | 'stop') =>
      command === 'start' ? cameraApi.start(camera.id, loop) : cameraApi.stop(camera.id),
    onMutate: () => queryClient.cancelQueries({ queryKey }),
    onSuccess: (updated, command) => {
      if (command === 'start') {
        setKeepLastFrame(true);
        setReplayVersion((version) => version + 1);
      } else {
        setKeepLastFrame(false);
      }
      queryClient.setQueryData<ReplayStatus>(queryKey, updated);
    },
    onSettled: () => { void queryClient.invalidateQueries({ queryKey }); },
  });

  return (
    <Card ref={viewer} className="camera-viewer min-w-0 gap-0 overflow-hidden py-0" role="region" aria-labelledby="camera-title">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-600">Synthetic Camera</p>
          <h3 id="camera-title" className="mt-1 text-2xl font-semibold wrap-anywhere">{camera.name}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={showReplay ? 'default' : 'secondary'} className="rounded-md px-3 py-1.5 text-sm">
            {showReplay ? 'Replay · 1×' : 'Source preview'}
          </Badge>
          {document.fullscreenEnabled && <Button variant="outline" type="button"
            onClick={() => void toggleFullscreen()}>{fullscreen ? 'Exit fullscreen' : 'Fullscreen'}</Button>}
        </div>
      </div>

      {showReplay
        ? <div className="footage-with-timeline grid">
          <ReplayVideo key={replayVersion} id={camera.id} stopping={status?.state === 'stopping'} />
          <FootageTimeline durationMs={camera.durationMs}
            positionMs={status?.state === 'running' ? status.sourceMs
              : status?.state === 'finished' ? camera.durationMs : 0} />
        </div>
        : <ClipPreview id={camera.id} />}

      <div className="grid gap-4 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div className="grid gap-0.5">
            <p className="font-semibold" role="status">
              {replay.isError ? 'Could not load replay status.' : status ? replayLabel[status.state] : 'Loading replay status…'}
            </p>
            <p className="text-sm text-slate-600">
              {showReplay ? 'Simulated shift · Recorded footage' : 'Scrub the timeline to inspect a frame, or start replay to play the clip.'}
            </p>
          </div>
          {status?.state === 'running' && <p className="text-sm font-medium text-slate-700 tabular-nums">
            Pass {status.passNumber}
          </p>}
        </div>
        {status?.state === 'unavailable' && <p className="error" role="alert">
          Replay could not read the clip. Check the preview and try again.
        </p>}
        {action.isError && <p className="error" role="alert">{action.error.message}</p>}
        {fullscreenError && <p className="error" role="alert">Could not switch fullscreen mode.</p>}
        <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 pt-4">
          {active
            ? <Button variant="outline" type="button" onClick={() => action.mutate('stop')}
                disabled={action.isPending || status?.state === 'stopping'}>Stop replay</Button>
            : <Button type="button" onClick={() => action.mutate('start')}
                disabled={!status || replay.isError || action.isPending}>Start replay</Button>}
          {showReplay && status?.state === 'finished' && <Button variant="outline" type="button"
            onClick={() => setKeepLastFrame(false)}>Open source preview</Button>}
          <div className="flex items-center gap-2">
            <Checkbox id={loopId} checked={loop} disabled={active || action.isPending}
              onCheckedChange={(checked) => setLoop(checked === true)} />
            <Label htmlFor={loopId}>Loop replay</Label>
          </div>
        </div>
      </div>
    </Card>
  );
}

function ClipPreview({ id }: { id: string }) {
  const video = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [attempt, setAttempt] = useState(0);
  const [durationMs, setDurationMs] = useState(0);
  const [positionMs, setPositionMs] = useState(0);

  function seek(position: number) {
    if (video.current) {
      video.current.currentTime = position / 1000;
      setPositionMs(position);
    }
  }

  return (
    <div className="footage-with-timeline grid">
      <div className="footage" onContextMenu={(event) => event.preventDefault()}>
        <video
          ref={video} key={attempt}
          className={`pointer-events-none ${state === 'unavailable' ? 'invisible' : ''}`}
          aria-label="Source clip preview" src={cameraApi.media(id)} preload="metadata"
          playsInline disablePictureInPicture disableRemotePlayback
          onPlay={(event) => event.currentTarget.pause()}
          onLoadedMetadata={(event) => {
            const duration = event.currentTarget.duration * 1000;
            if (Number.isFinite(duration) && duration > 0) {
              setDurationMs(Math.max(1, Math.round(duration)));
              setState('ready');
            } else {
              setState('unavailable');
            }
          }}
          onError={() => setState('unavailable')}
        />
        {state === 'loading' && <p className="footage-message" role="status">Loading preview…</p>}
        {state === 'unavailable' && <div className="footage-message">
          <p role="alert">Source preview unavailable.</p>
          <Button type="button" variant="outline" className="mt-3" onClick={() => {
            setState('loading');
            setPositionMs(0);
            setAttempt(attempt + 1);
          }}>Retry preview</Button>
        </div>}
      </div>
      {state === 'ready' && <FootageTimeline durationMs={durationMs} positionMs={positionMs} onSeek={seek} />}
    </div>
  );
}

function FootageTimeline({ durationMs, positionMs, onSeek }: {
  durationMs: number;
  positionMs: number;
  onSeek?: (positionMs: number) => void;
}) {
  const id = useId();
  const position = clock(positionMs);
  const duration = clock(durationMs);
  const valueText = `${position} of ${duration}`;

  return (
    <div className="border-b border-slate-200 bg-slate-50 px-5 py-3 sm:px-6">
      <div className="mb-1 flex items-center justify-between gap-3 text-sm font-medium text-slate-700">
        <span id={id}>{onSeek ? 'Preview timeline' : 'Replay timeline'}</span>
        <span className="tabular-nums">{position} / {duration}</span>
      </div>
      <div className="grid h-6 items-center">
        {onSeek
          ? <Slider className="h-6" max={durationMs} step={Math.max(1, Math.round(durationMs / 100))}
            value={[positionMs]} thumbProps={{ 'aria-labelledby': id, 'aria-valuetext': valueText }}
            onValueChange={([position]) => { if (position !== undefined) onSeek(position); }} />
          : <Progress max={durationMs} value={positionMs} aria-labelledby={id} aria-valuetext={valueText} />}
      </div>
    </div>
  );
}

function ReplayVideo({ id, stopping }: { id: string; stopping: boolean }) {
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="footage">
      {!stopping && !unavailable && <img key={attempt} src={cameraApi.video(id)} alt="Replay footage"
        onError={() => setUnavailable(true)} />}
      {stopping && <p className="footage-message">Closing replay footage…</p>}
      {!stopping && unavailable && <div className="footage-message">
        <p role="alert">Replay footage unavailable.</p>
        <Button type="button" variant="outline" className="mt-3" onClick={() => {
          setUnavailable(false);
          setAttempt(attempt + 1);
        }}>Retry replay footage</Button>
      </div>}
    </div>
  );
}
