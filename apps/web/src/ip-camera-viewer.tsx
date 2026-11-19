import { useMutation, useQuery } from '@tanstack/react-query';
import type { CaptureStatus, IpCamera } from '@sensewell/contracts';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { cameraApi } from './camera-api';
import { ZoneEditor } from './zone-editor';

const captureLabel: Record<CaptureStatus['state'], string> = {
  connecting: 'Connecting to camera…',
  connected: 'Connected · Recording',
  unavailable: 'Feed unavailable · Retrying',
  blocked: 'Camera endpoint approval required',
};

export function IpCameraViewer({ camera, tenantId, onRemoved }: {
  camera: IpCamera;
  tenantId: string;
  onRemoved: () => void;
}) {
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const capture = useQuery({
    queryKey: ['capture', tenantId, camera.id],
    queryFn: ({ signal }) => cameraApi.capture(camera.id, signal),
    refetchInterval: 1000,
    retry: false,
  });
  const remove = useMutation({ mutationFn: () => cameraApi.remove(camera.id), onSuccess: onRemoved });
  const connected = !capture.isError && capture.data?.state === 'connected';
  const status = capture.isError ? 'Could not load capture status.'
    : capture.data ? captureLabel[capture.data.state] : 'Loading capture status…';

  return (
    <Card className="camera-viewer min-w-0 gap-0 overflow-hidden py-0" role="region" aria-labelledby="camera-title">
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5 sm:px-6">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-600">IP camera</p>
          <h3 id="camera-title" className="mt-1 text-2xl font-semibold wrap-anywhere">{camera.name}</h3>
          <p className="mt-2 text-sm font-medium" role="status">{status}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => setConfirmingRemoval(true)}
          disabled={confirmingRemoval}>Remove camera</Button>
      </div>
      {confirmingRemoval && <div className="grid gap-3 border-t px-5 py-4 sm:px-6">
        <p>Removing this camera stops capture and removes it from the workspace.</p>
        {remove.isError && <p className="error" role="alert">{remove.error.message}</p>}
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
            {remove.isPending ? 'Removing camera…' : 'Confirm removal'}
          </Button>
          <Button type="button" variant="outline" disabled={remove.isPending}
            onClick={() => { remove.reset(); setConfirmingRemoval(false); }}>Cancel</Button>
        </div>
      </div>}
      <LivePreview id={camera.id} tenantId={tenantId} connected={connected} status={status} />
      <Recordings cameraId={camera.id} tenantId={tenantId} unavailable={capture.data?.state === 'unavailable' || capture.data?.state === 'blocked'} />
    </Card>
  );
}

function LivePreview({ id, tenantId, connected, status }: {
  id: string; tenantId: string; connected: boolean; status: string;
}) {
  const [size, setSize] = useState<{ width: number; height: number }>();

  return (
    <ZoneEditor id={id} tenantId={tenantId} sourceSize={connected ? size : undefined}>
      {connected ? <LiveImage id={id} onSize={setSize} /> : <p className="footage-message">{status}</p>}
    </ZoneEditor>
  );
}

function LiveImage({ id, onSize }: {
  id: string;
  onSize: (size?: { width: number; height: number }) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [unavailable, setUnavailable] = useState(false);

  return (
    <>
      {!unavailable && <img key={attempt} src={cameraApi.liveVideo(id)} alt="Live camera feed"
        onLoad={({ currentTarget: { naturalWidth: width, naturalHeight: height } }) => {
          if (width && height) onSize({ width, height });
        }}
        onError={() => { onSize(undefined); setUnavailable(true); }} />}
      {unavailable && <div className="footage-message">
        <p role="alert">Live preview unavailable.</p>
        <Button type="button" variant="outline" className="mt-3" onClick={() => {
          setUnavailable(false);
          setAttempt(attempt + 1);
        }}>Retry preview</Button>
      </div>}
    </>
  );
}

const dateFormat = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium', timeStyle: 'medium',
});
const gapMs = 1000;

function Recordings({ cameraId, tenantId, unavailable }: {
  cameraId: string;
  tenantId: string;
  unavailable: boolean;
}) {
  const [selection, setSelection] = useState<{ id: string; attempt: number }>();
  const [playbackError, setPlaybackError] = useState(false);
  const recordings = useQuery({
    queryKey: ['recordings', tenantId, cameraId],
    queryFn: ({ signal }) => cameraApi.recordings(cameraId, signal),
    refetchInterval: 5000,
    retry: false,
  });
  const segments = recordings.data ?? [];
  const index = segments.findIndex(({ id }) => id === selection?.id);
  const selected = segments[index];
  const next = segments[index + 1];

  function select(id: string) {
    setPlaybackError(false);
    setSelection((previous) => ({ id, attempt: (previous?.attempt ?? 0) + 1 }));
  }

  return (
    <section className="grid gap-3 border-t px-5 py-5 sm:px-6" aria-labelledby="recordings-title">
      <h4 id="recordings-title" className="font-semibold">Recorded footage</h4>
      {recordings.isPending && <p role="status">Loading recordings…</p>}
      {recordings.isError && <p className="error" role="alert">{recordings.error.message}</p>}
      {recordings.isSuccess && !segments.length && <p className="text-sm text-slate-600">No recordings available yet.</p>}
      {selected && <video key={selection?.attempt} className="w-full rounded-md bg-black"
        src={cameraApi.recording(cameraId, selected.id)} aria-label="Recorded camera footage"
        controls playsInline autoPlay preload="metadata" onError={() => setPlaybackError(true)}
        onEnded={() => {
          if (next && Date.parse(next.startedAt) - Date.parse(selected.endedAt) < gapMs) select(next.id);
        }} />}
      {playbackError && <p className="error" role="alert">Recorded footage is unavailable.</p>}
      {!!segments.length && <ol className="max-h-72 overflow-y-auto divide-y rounded-md border" aria-label="Recording timeline, newest first">
        {unavailable && <li className="px-3 py-2 text-sm text-slate-600">Footage currently unavailable</li>}
        {segments.map((segment, index) => {
          const newer = segments[index + 1];
          return (
            <RecordingEntry key={segment.id} segment={segment}
              gapUntil={newer && Date.parse(newer.startedAt) - Date.parse(segment.endedAt) >= gapMs
                ? newer.startedAt : undefined}
              selected={selection?.id === segment.id} onSelect={() => select(segment.id)} />
          );
        }).reverse()}
      </ol>}
    </section>
  );
}

function RecordingEntry({ segment, gapUntil, selected, onSelect }: {
  segment: { startedAt: string; endedAt: string };
  gapUntil?: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const start = dateFormat.format(new Date(segment.startedAt));
  const end = dateFormat.format(new Date(segment.endedAt));
  return (
    <>
      {gapUntil && <li className="px-3 py-2 text-sm text-slate-600">
        Footage unavailable · {end} – {dateFormat.format(new Date(gapUntil))}
      </li>}
      <li>
        <Button type="button" variant="ghost" aria-pressed={selected} onClick={onSelect}
          className="h-auto w-full justify-start whitespace-normal rounded-none px-3 py-2 text-left aria-pressed:bg-accent">
          Play {start} – {end}
        </Button>
      </li>
    </>
  );
}
