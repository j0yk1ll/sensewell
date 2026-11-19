import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ReplayStatus, SyntheticCamera } from '@sensewell/contracts';
import { useState } from 'react';
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
    <section className="panel min-w-0 overflow-hidden" aria-labelledby="camera-title">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-600">Synthetic Camera</p>
          <h3 id="camera-title" className="mt-1 text-2xl font-semibold wrap-anywhere">{camera.name}</h3>
        </div>
        <span className={`rounded-md px-3 py-1.5 text-sm font-semibold ${showReplay ? 'bg-teal-100 text-teal-950' : 'bg-slate-100 text-slate-700'}`}>
          {showReplay ? 'Replay · 1×' : 'Source preview'}
        </span>
      </div>

      {showReplay
        ? <ReplayVideo key={replayVersion} id={camera.id} stopping={status?.state === 'stopping'} />
        : <ClipPreview id={camera.id} />}

      <div className="grid gap-4 px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <div className="grid gap-0.5">
            <p className="font-semibold" role="status">
              {replay.isError ? 'Could not load replay status.' : status ? replayLabel[status.state] : 'Loading replay status…'}
            </p>
            <p className="text-sm text-slate-600">
              {showReplay ? 'Simulated shift · Recorded footage' : 'Recorded footage · Preview does not start replay'}
            </p>
          </div>
          {status?.state === 'running' && <p className="text-sm font-medium text-slate-700 tabular-nums">
            Pass {status.passNumber} · {clock(status.sourceMs)} / {clock(camera.durationMs)}
          </p>}
        </div>
        {status?.state === 'unavailable' && <p className="error" role="alert">
          Replay could not read the clip. Check the preview and try again.
        </p>}
        {action.isError && <p className="error" role="alert">{action.error.message}</p>}
        <div className="flex flex-wrap items-center gap-4 border-t border-slate-200 pt-4">
          {active
            ? <button className="button" type="button" onClick={() => action.mutate('stop')}
                disabled={action.isPending || status?.state === 'stopping'}>Stop replay</button>
            : <button className="button primary" type="button" onClick={() => action.mutate('start')}
                disabled={!status || replay.isError || action.isPending}>Start replay</button>}
          {showReplay && status?.state === 'finished' && <button className="button" type="button"
            onClick={() => setKeepLastFrame(false)}>Open source preview</button>}
          <label className="flex items-center gap-2 text-sm font-medium">
            <input className="size-4 accent-teal-700" type="checkbox" checked={loop}
              disabled={active || action.isPending} onChange={(event) => setLoop(event.target.checked)} />
            Loop replay
          </label>
        </div>
      </div>
    </section>
  );
}

function ClipPreview({ id }: { id: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="footage">
      <video
        key={attempt} className={state === 'unavailable' ? 'invisible' : undefined} aria-label="Source clip preview"
        src={cameraApi.media(id)} preload="metadata" playsInline controls
        onLoadedMetadata={() => setState('ready')} onError={() => setState('unavailable')}
      />
      {state === 'loading' && <p className="footage-message" role="status">Loading preview…</p>}
      {state === 'unavailable' && <div className="footage-message">
        <p role="alert">Source preview unavailable.</p>
        <button type="button" className="button mt-3" onClick={() => {
          setState('loading');
          setAttempt(attempt + 1);
        }}>Retry preview</button>
      </div>}
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
        <button type="button" className="button mt-3" onClick={() => {
          setUnavailable(false);
          setAttempt(attempt + 1);
        }}>Retry replay footage</button>
      </div>}
    </div>
  );
}
