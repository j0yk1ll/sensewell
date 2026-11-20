import { useQuery } from '@tanstack/react-query';
import type { ZoneEntryEvent } from '@sensewell/contracts';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { formatClipTime } from '@/lib/utils';
import { cameraApi } from './camera-api';
import { ZoneOverlay } from './zone-overlay';

function replayPosition(event: ZoneEntryEvent) {
  return `Replay pass ${event.passNumber} · ${formatClipTime(event.sourceMs, true)}`;
}

export function ZoneEntryHistory({ id, tenantId, replayActive }: {
  id: string; tenantId: string; replayActive: boolean;
}) {
  const [selected, setSelected] = useState<string>();
  const openButton = useRef<HTMLButtonElement | null>(null);
  const history = useQuery({
    queryKey: ['zone-entry-history', tenantId, id],
    queryFn: ({ signal }) => cameraApi.eventHistory(id, signal),
    refetchInterval: replayActive ? 1000 : 5000,
    retry: false,
  });

  return (
    <Card className="gap-4 px-5 sm:px-6">
      <h3 className="text-lg font-semibold">Event history</h3>
      {selected && <EntryEvidence key={selected} id={id} tenantId={tenantId} eventId={selected} onClose={() => {
        setSelected(undefined);
        openButton.current?.focus();
      }} />}
      {history.isPending && <p role="status">Loading event history…</p>}
      {history.isError && <p className="error" role="alert">{history.error.message}</p>}
      {history.data?.length === 0 && <p className="text-sm text-slate-600">No confirmed person zone entries yet.</p>}
      {!!history.data?.length && <ul className="divide-y border-t">
        {history.data.map((event) => (
          <li key={event.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div className="min-w-0 wrap-anywhere">
              <p className="font-medium">{event.ruleName}</p>
              <p className="text-sm text-slate-600">{event.cameraName} · {event.zoneName} · Confirmed zone entry</p>
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

function EntryEvidence({ id, tenantId, eventId, onClose }: {
  id: string; tenantId: string; eventId: string; onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const image = useRef<HTMLDivElement>(null);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number }>();
  const [videoError, setVideoError] = useState(false);
  const evidence = useQuery({
    queryKey: ['zone-entry-evidence', tenantId, id, eventId],
    queryFn: ({ signal }) => cameraApi.eventEvidence(id, eventId, signal),
    retry: false,
  });
  useEffect(() => heading.current?.focus(), []);
  const event = evidence.data;
  const confidence = event && `Person ${Math.round(event.person.confidence * 100)}% confidence`;

  return (
    <section className="grid gap-3 rounded-md border bg-slate-50 p-3 sm:p-4" aria-label="Zone-entry evidence">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 ref={heading} tabIndex={-1} className="font-semibold">Crossing evidence</h4>
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
                alt="Source frame at the confirmed zone entry"
                onLoad={({ currentTarget }) => setSourceSize({
                  width: currentTarget.naturalWidth, height: currentTarget.naturalHeight,
                })} />
              {sourceSize && <>
                <ZoneOverlay footage={image} sourceSize={sourceSize} zones={[event.zone]} />
                <DetectionBox box={event.person.box} />
              </>}
            </div>
            <figcaption className="mt-1 text-sm text-slate-700">Analyzed crossing frame · {confidence}</figcaption>
          </figure>
          <div className="min-w-0">
            <div className="footage">
              <video aria-label="Timestamped source clip" src={cameraApi.media(id)} preload="metadata" controls playsInline
                onLoadedMetadata={({ currentTarget }) => { currentTarget.currentTime = event.sourceMs / 1000; }}
                onError={() => setVideoError(true)} />
            </div>
            <p className="mt-1 text-sm text-slate-700">Source clip · {formatClipTime(event.sourceMs, true)}</p>
            {videoError && <p className="error" role="alert">Source clip unavailable.</p>}
          </div>
        </div>
      </>}
    </section>
  );
}

function DetectionBox({ box: [left, top, right, bottom] }: { box: [number, number, number, number] }) {
  return <div aria-hidden="true" className="pointer-events-none absolute border-2 border-amber-300 shadow-[0_0_0_1px_#020617]"
    style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${(right - left) * 100}%`, height: `${(bottom - top) * 100}%` }} />;
}
