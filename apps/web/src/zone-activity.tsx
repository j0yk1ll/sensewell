import { useQuery } from '@tanstack/react-query';
import { warehouseObjectLabels, zoneActivityRuleKey, type ZoneActivity } from '@sensewell/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatClipTime } from '@/lib/utils';
import { cameraApi } from './camera-api';
import { ActivityChat } from './activity-chat';
import { DetectionBox, GroundMarkers, GroundPositionDescription, ZoneOverlay } from './zone-overlay';

type RuleActivity = ZoneActivity['rules'][number];
type Sample = RuleActivity['crossings'][number]['before'];
type InspectObservation = (sample: Sample, button: HTMLButtonElement) => void;
const time = (ms: number) => formatClipTime(ms, true);
const visitReason = {
  'ground-unknown': 'Ground position uncertain',
  'possible-exit': 'Exit obscured',
  ambiguous: 'Track match ambiguous',
  expired: 'Track recovery expired',
  'rule-changed': 'Rule or zone changed',
  'pass-ended': 'Replay pass ended',
};

export function ZoneActivityPanel({ id, tenantId, durationMs, replayActive }: {
  id: string; tenantId: string; durationMs: number; replayActive: boolean;
}) {
  const [selectedPass, setSelectedPass] = useState('');
  const [atMs, setAtMs] = useState<number>();
  const passSelectId = useId();
  const timeInputId = useId();
  const [inspection, setInspection] = useState<{ passId: string; sample: Sample; zoneName: string }>();
  const inspectionTrigger = useRef<HTMLButtonElement | null>(null);
  const passes = useQuery({
    queryKey: ['zone-activity-passes', tenantId, id],
    queryFn: ({ signal }) => cameraApi.activityPasses(id, signal),
    refetchInterval: replayActive ? 1000 : 5000,
    retry: false,
  });
  const passId = selectedPass || passes.data?.[0]?.id;
  const activity = useQuery({
    queryKey: ['zone-activity', tenantId, id, passId, atMs],
    queryFn: ({ signal }) => cameraApi.zoneActivity(id, passId!, atMs, signal),
    enabled: !!passId,
    placeholderData: (previous) => previous?.passId === passId ? previous : undefined,
    refetchInterval: ({ state }) => state.data?.active || (replayActive && !state.data) ? 2000 : false,
    retry: false,
  });
  const data = activity.data;
  const passNumber = passes.data?.find(({ id }) => id === passId)?.passNumber;
  const coverage = data?.coverage;

  return (
    <Card className="gap-4 px-5 sm:px-6">
      <h3 className="text-lg font-semibold">Zone activity</h3>
      {(passes.isPending || (passId && activity.isPending)) && <p role="status">Loading zone activity…</p>}
      {(passes.error || activity.error) && <p className="error" role="alert">{(passes.error ?? activity.error)?.message}</p>}
      {passes.data?.length === 0 && <p className="text-sm text-slate-600">Start replay to collect zone activity.</p>}
      {!!passes.data?.length && <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-2">
          <Label htmlFor={passSelectId}>Replay pass</Label>
          <select id={passSelectId} className="h-9 rounded-md border bg-white px-2 text-sm"
            value={selectedPass} onChange={(event) => {
              setSelectedPass(event.target.value);
              setInspection(undefined);
            }}>
            <option value="">Latest pass ({passes.data[0]!.passNumber})</option>
            {passes.data.map(({ id, passNumber, startedAt }) => <option key={id} value={id}>
              Pass {passNumber} · {new Date(startedAt).toLocaleString()}
            </option>)}
          </select>
        </div>
        <form className="flex flex-wrap items-end gap-2" onSubmit={(event) => {
          event.preventDefault();
          const seconds = new FormData(event.currentTarget).get('seconds');
          setAtMs(seconds ? Math.round(Number(seconds) * 1000) : undefined);
        }}>
          <div className="grid gap-2">
            <Label htmlFor={timeInputId}>Occupancy at source time (seconds)</Label>
            <Input id={timeInputId} name="seconds" type="number" min="0" max={durationMs / 1000}
              step="0.001" placeholder="Latest analyzed frame" />
          </div>
          <Button type="submit" variant="outline">Show occupancy</Button>
        </form>
      </div>}
      {passId && <ActivityChat cameraId={id} passId={passId} />}
      {activity.isPlaceholderData && <p role="status" className="text-sm text-slate-600">Updating occupancy…</p>}
      {data && (coverage
        ? <p className="text-sm text-slate-600">Analyzed observations from {time(coverage.firstMs)} to {time(coverage.lastMs)}
          {data.active ? ' · Replay pass in progress' : ' · Replay pass ended'}</p>
        : <p className="text-sm text-slate-600">No analyzed observations in this replay pass yet.</p>)}
      {coverage && data.rules.length === 0 && <p className="text-sm text-slate-600">No rules were enabled during the analyzed footage.</p>}
      {inspection && passId === inspection.passId && <ObservationInspector
        key={`${passId}:${inspection.sample.sourceMs}`} id={id} passId={inspection.passId} passNumber={passNumber}
        sample={inspection.sample} zoneName={inspection.zoneName} onClose={() => {
          setInspection(undefined);
          inspectionTrigger.current?.focus();
        }}
      />}
      {data?.rules.map((rule) => <RuleEvidence key={zoneActivityRuleKey(rule)} id={id} rule={rule} atMs={atMs}
        onInspect={(sample, button) => {
          setSelectedPass(data.passId);
          inspectionTrigger.current = button;
          setInspection({ sample, passId: data.passId, zoneName: rule.zoneName });
        }}
      />)}
    </Card>
  );
}

function SourceTime({ id, ms, endMs }: { id: string; ms: number; endMs?: number }) {
  return <a className="font-medium text-sky-800 underline underline-offset-2" target="_blank" rel="noreferrer"
    href={`${cameraApi.media(id)}#t=${ms / 1000}${endMs === undefined ? '' : `,${endMs / 1000}`}`}
    aria-label={`Open source footage at ${time(ms)}${endMs === undefined ? '' : ` to ${time(endMs)}`} in a new tab`}>
    {time(ms)}{endMs === undefined ? '' : ` to ${time(endMs)}`}
  </a>;
}

function Observation({ sample, onInspect }: { sample: Sample; onInspect: InspectObservation }) {
  return <button type="button" className="font-medium text-sky-800 underline underline-offset-2"
    onClick={(event) => onInspect(sample, event.currentTarget)}>
    {time(sample.sourceMs)} ({Math.round(sample.detection.confidence * 100)}% confidence)
  </button>;
}

function ObservationInspector({ id, passId, passNumber, sample, zoneName, onClose }: {
  id: string; passId: string; passNumber?: number; sample: Sample; zoneName: string; onClose: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  const footage = useRef<HTMLDivElement>(null);
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number }>();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  const sourceSeconds = sample.sourceMs / 1000;
  useEffect(() => heading.current?.focus(), []);

  return <section className="grid gap-3 rounded-md border bg-slate-50 p-3 sm:p-4" aria-label="Observation evidence">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 ref={heading} tabIndex={-1} className="font-semibold">Observation evidence</h4>
      <Button type="button" variant="outline" onClick={onClose}>Close observation</Button>
    </div>
    <p className="text-sm text-slate-700">
      <span title={passId}>Replay pass {passNumber}</span> · {time(sample.sourceMs)} · {zoneName}
      {' · '}{warehouseObjectLabels[sample.detection.objectType]} {Math.round(sample.detection.confidence * 100)}% confidence
    </p>
    <figure className="w-full max-w-2xl">
      <div ref={footage} className="relative">
        <video className="block w-full" aria-label="Source frame with the selected observation overlay"
          src={cameraApi.media(id)} muted playsInline preload="auto"
          onLoadedMetadata={({ currentTarget }) => {
            setSourceSize({ width: currentTarget.videoWidth, height: currentTarget.videoHeight });
            currentTarget.currentTime = sourceSeconds;
          }}
          onLoadedData={({ currentTarget }) => {
            if (!currentTarget.seeking && currentTarget.currentTime === sourceSeconds) setReady(true);
          }}
          onSeeked={() => setReady(true)} onError={() => setError(true)} />
        {ready && !error && sourceSize && <>
          <ZoneOverlay footage={footage} sourceSize={sourceSize}
            zones={[{ id: passId, name: zoneName, points: sample.points }]} />
          <DetectionBox box={sample.detection.box} />
          {sample.ground && <GroundMarkers decision={sample.ground} />}
        </>}
      </div>
      <figcaption className="mt-1 text-sm text-slate-700">
        {error && <span className="error" role="alert">Source footage unavailable. </span>}
        {!error && !ready && <span role="status">Loading source frame… </span>}
        {sample.ground && <GroundPositionDescription decision={sample.ground} />}
      </figcaption>
    </figure>
    <p className="text-sm">Open source clip at <SourceTime id={id} ms={sample.sourceMs} /></p>
  </section>;
}

function RuleEvidence({ id, rule, atMs, onInspect }: {
  id: string; rule: RuleActivity; atMs?: number; onInspect: InspectObservation;
}) {
  const { occupancy, crossings, gaps, visits } = rule;
  const positions = occupancy?.positions ?? occupancy?.inside ?? [];
  return (
    <section className="grid gap-3 border-t pt-4 text-sm">
      <div>
        <h4 className="text-base font-semibold">{rule.ruleName}</h4>
        <p className="text-slate-600">{rule.zoneName} · {warehouseObjectLabels[rule.objectType]}</p>
      </div>
      <dl className="grid gap-2 sm:grid-cols-3">
        <div><dt>Confirmed observed entries</dt><dd className="text-lg font-semibold">{rule.entries}</dd></div>
        <div><dt>Estimated distinct entrants</dt><dd className="text-lg font-semibold">{rule.distinctEntrants}</dd></div>
        <div>
          <dt>Observed occupancy</dt>
          <dd>{occupancy
            ? <><strong className="text-lg">{occupancy.inside.length}</strong> at <SourceTime id={id} ms={occupancy.sourceMs} /></>
            : <>Unavailable{atMs === undefined ? '' : ` at ${time(atMs)}`}</>}</dd>
          {!!occupancy?.unknownTrackIds.length && <dd className="text-slate-600">
            Unknown position for {occupancy.unknownTrackIds.length} {occupancy.unknownTrackIds.length === 1 ? 'track' : 'tracks'}
          </dd>}
        </div>
      </dl>
      {positions.length > 0 && <details>
        <summary className="cursor-pointer font-medium">{occupancy?.positions ? 'Ground position observations' : 'Occupancy observations'}</summary>
        <ul className="list-disc pl-5 pt-1">
          {positions.map((sample) => <li key={sample.trackId}>
            Track {sample.trackId} · <Observation onInspect={onInspect} sample={sample} />
            {sample.ground && <> · <GroundPositionDescription decision={sample.ground} /></>}
          </li>)}
        </ul>
      </details>}
      <details>
        <summary className="cursor-pointer font-medium">Crossing evidence ({crossings.length})</summary>
        <ul className="divide-y">
          {crossings.map(({ trackId, certainty, direction, before, after }) => (
            <li key={`${trackId}:${after.sourceMs}`} className="py-2">
              <p className="font-medium capitalize">{certainty} {direction} · Track {trackId}</p>
              {(certainty === 'possible' || after.ground) && <p>
                {certainty === 'possible' ? 'Possible crossing interval' : 'Observed crossing interval'}{' '}
                <SourceTime id={id} ms={before.sourceMs} endMs={after.sourceMs} />
              </p>}
              <p>Before <Observation onInspect={onInspect} sample={before} /> · After <Observation onInspect={onInspect} sample={after} /></p>
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="cursor-pointer font-medium">Observation gaps ({gaps.length})</summary>
        <ul className="divide-y">
          {gaps.map(({ trackId, startMs, endMs, reason, observation }) => (
            <li key={`${trackId}:${startMs}`} className="py-2">
              Track {trackId} · {reason === 'recovered' ? 'Recovered' : reason === 'missing' ? 'Position unknown' : visitReason[reason]}
              {' · '}{endMs === null ? 'Last qualifying observation ' : 'Gap between '}
              <SourceTime id={id} ms={startMs} endMs={endMs ?? undefined} />
              {observation && <> · Uncertain observation <Observation onInspect={onInspect} sample={observation} /></>}
            </li>
          ))}
        </ul>
      </details>
      <details>
        <summary className="cursor-pointer font-medium">Visits and dwell ({visits.length})</summary>
        <ul className="divide-y">
          {visits.map(({ trackId, state, reason, entry, exit, firstInside, lastInside }) => (
            <li key={`${trackId}:${firstInside.sourceMs}`} className="py-2">
              <p className="font-medium">{state === 'open'
                ? entry ? 'Open visit' : 'Partial visit · ongoing'
                : state === 'complete' ? 'Complete visit' : 'Partial visit'} · Track {trackId}</p>
              {reason && <p>{visitReason[reason]}</p>}
              <p>Entry {entry ? <Observation onInspect={onInspect} sample={entry} /> : 'unknown'}
                {' · '}Exit {exit ? <Observation onInspect={onInspect} sample={exit} /> : state === 'open' ? 'pending' : 'unknown'}</p>
              {!entry && <p>First observed inside <Observation onInspect={onInspect} sample={firstInside} /></p>}
              {!exit && <p>Last observed inside <Observation onInspect={onInspect} sample={lastInside} /></p>}
              {entry && exit && <p>{entry.ground ? 'Dwell estimate' : 'Dwell'} {((exit.sourceMs - entry.sourceMs) / 1000).toFixed(3)} s</p>}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
