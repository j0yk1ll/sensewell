import { useQuery } from '@tanstack/react-query';
import { warehouseObjectLabels, type ZoneEntryEvent } from '@sensewell/contracts';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatClipTime } from '@/lib/utils';
import { cameraApi } from './camera-api';
import { ZoneOverlay } from './zone-overlay';

function replayPosition(event: ZoneEntryEvent) {
  return `Replay pass ${event.passNumber} · ${formatClipTime(event.sourceMs, true)}`;
}

export const zoneEntryHistoryKey = (id: string, tenantId: string) => ['zone-entry-history', tenantId, id];

export function ZoneEntryHistory({ id, tenantId, replayActive }: {
  id: string; tenantId: string; replayActive: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const openButton = useRef<HTMLButtonElement | null>(null);
  const history = useQuery({
    queryKey: zoneEntryHistoryKey(id, tenantId),
    queryFn: ({ signal }) => cameraApi.eventHistory(id, signal),
    refetchInterval: replayActive ? 1000 : 5000,
    retry: false,
  });

  return (
    <Card className="gap-4 px-5 sm:px-6">
      <h3 className="text-lg font-semibold">Event history</h3>
      {selected && <CrossingEvidence key={selected} id={id} tenantId={tenantId} eventId={selected} onClose={() => {
        setSelected(undefined);
        openButton.current?.focus();
      }} />}
      {history.isPending && <p role="status">Loading event history…</p>}
      {history.isError && <p className="error" role="alert">{history.error.message}</p>}
      {history.data?.length === 0 && <p className="text-sm text-slate-600">No confirmed zone entries or exits yet.</p>}
      {!!history.data?.length && <ul className="divide-y border-t">
        {history.data.map((event) => (
          <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 wrap-anywhere">
              <p className="font-medium">{event.ruleName}</p>
              <p className="text-sm text-slate-600">{event.cameraName} · {event.zoneName} · {warehouseObjectLabels[event.objectType]} · Confirmed zone {event.direction}</p>
              <p className="text-sm tabular-nums text-slate-600">
                <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time>
                {' · '}<span title={event.passId}>{replayPosition(event)}</span>
              </p>
            </div>
            <Button type="button" variant="outline" aria-expanded={selected === event.id}
              onClick={(click) => {
                openButton.current = click.currentTarget;
                setSelected(event.id);
              }}>Open evidence</Button>
          </li>
        ))}
      </ul>}
    </Card>
  );
}

function CrossingEvidence({ id, tenantId, eventId, onClose }: {
  id: string; tenantId: string; eventId: string; onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const image = useRef<HTMLDivElement>(null);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number }>();
  const evidence = useQuery({
    queryKey: ['zone-entry-evidence', tenantId, id, eventId],
    queryFn: ({ signal }) => cameraApi.eventEvidence(id, eventId, signal),
    retry: false,
  });
  useEffect(() => heading.current?.focus(), []);
  const event = evidence.data;
  const confidence = event && `${warehouseObjectLabels[event.objectType]} ${Math.round(event.detection.confidence * 100)}% confidence`;

  return (
    <section className="grid gap-3 rounded-md border bg-slate-50 p-3 sm:p-4" aria-label="Zone crossing evidence">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 ref={heading} tabIndex={-1} className="font-semibold">{event?.direction === 'exit' ? 'Zone exit evidence' : event ? 'Zone entry evidence' : 'Crossing evidence'}</h4>
        <Button type="button" variant="outline" onClick={onClose}>Close evidence</Button>
      </div>
      {evidence.isPending && <p role="status">Loading crossing evidence…</p>}
      {evidence.isError && <p className="error" role="alert">{evidence.error.message}</p>}
      {event && <>
        <p className="text-sm tabular-nums text-slate-700">{replayPosition(event)}</p>
        <p className="text-xs text-slate-600 wrap-anywhere">Replay pass ID {event.passId}</p>
        <div className="grid gap-3 lg:grid-cols-2">
          <figure className="min-w-0">
            <div ref={image} className="relative">
              <img className="block w-full" src={`data:image/jpeg;base64,${event.jpeg}`}
                alt={`Source frame at the confirmed zone ${event.direction}`}
                onLoad={({ currentTarget }) => setSourceSize({
                  width: currentTarget.naturalWidth, height: currentTarget.naturalHeight,
                })} />
              {sourceSize && <>
                <ZoneOverlay footage={image} sourceSize={sourceSize} zones={[event.zone]} />
                <DetectionBox box={event.detection.box} />
              </>}
            </div>
            <figcaption className="mt-1 text-sm text-slate-700">Analyzed crossing frame · {confidence}</figcaption>
          </figure>
          <EvidenceClip id={id} tenantId={tenantId} eventId={eventId} window={event.window} />
        </div>
      </>}
    </section>
  );
}

function EvidenceClip({ id, tenantId, eventId, window }: {
  id: string; tenantId: string; eventId: string; window: { startMs: number; endMs: number };
}) {
  const clip = useQuery({
    queryKey: ['event-evidence-clip', tenantId, id, eventId],
    queryFn: ({ signal }) => cameraApi.eventEvidenceClip(id, eventId, signal),
    staleTime: Infinity,
    gcTime: 0,
    retry: false,
  });
  const [url, setUrl] = useState<string>();
  const [videoError, setVideoError] = useState(false);
  useEffect(() => {
    if (!clip.data) return;
    const objectUrl = URL.createObjectURL(clip.data);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [clip.data]);

  return (
    <div className="min-w-0">
      <div className="footage">
        {url && <video aria-label="Timestamped evidence clip" src={url} preload="metadata" controls playsInline
          onError={() => setVideoError(true)} />}
        {!url && !clip.isError && <p className="footage-message" role="status">Preparing evidence clip…</p>}
        {(clip.isError || videoError) && <p className="footage-message" role="alert">Evidence clip unavailable.</p>}
      </div>
      <p className="mt-1 text-sm tabular-nums text-slate-700">
        Source clip · {formatClipTime(window.startMs, true)} to {formatClipTime(window.endMs, true)}
      </p>
    </div>
  );
}

function DetectionBox({ box: [left, top, right, bottom] }: { box: [number, number, number, number] }) {
  return <div aria-hidden="true" className="pointer-events-none absolute border-2 border-amber-300 shadow-[0_0_0_1px_#020617]"
    style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${(right - left) * 100}%`, height: `${(bottom - top) * 100}%` }} />;
}
