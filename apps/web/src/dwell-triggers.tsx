import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DwellMatch, ForkliftDwellCondition, dwellTrigger } from '@sensewell/contracts';
import { useId, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cameraApi, cameraZoneQuery, triggerApi } from './camera-api';

type Trigger = ReturnType<typeof dwellTrigger.parse>;
const timestamp = (ms: number) => new Date(ms).toLocaleString();
const localTimeInput = (ms: number) =>
  new Date(ms - new Date(ms).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

function conditionText({ zone, durationMs }: ForkliftDwellCondition) {
  return `The same forklift remains in ${zone.name} continuously for ${durationMs / 60_000} minutes after a confirmed entry.`;
}

export function DwellTriggers({ cameraId, tenantId }: { cameraId: string; tenantId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ['dwell-triggers', tenantId, cameraId];
  const zones = useQuery(cameraZoneQuery(cameraId, tenantId));
  const workspace = useQuery({
    queryKey, queryFn: ({ signal }) => triggerApi.workspace(cameraId, signal), refetchInterval: 3000, retry: false,
  });
  const [draftId, setDraftId] = useState<string>();
  const draft = useMutation({
    mutationFn: ({ zoneId, description }: { zoneId: string; description: string }) =>
      triggerApi.draft(cameraId, zoneId, description),
    onSuccess(result) {
      setDraftId(result.trigger?.id);
      void queryClient.invalidateQueries({ queryKey });
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => triggerApi.setEnabled(cameraId, id, enabled),
    async onSuccess(trigger) {
      queryClient.setQueryData<typeof workspace.data>(queryKey, (current) => current && ({
        ...current, triggers: current.triggers.map((item) => item.id === trigger.id ? trigger : item),
      }));
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  function submitDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    draft.mutate({ zoneId: String(data.get('zoneId')), description: String(data.get('description')) });
  }

  return (
    <section className="grid gap-5 border-t px-5 py-5 sm:px-6" aria-labelledby="trigger-title">
      <h4 id="trigger-title" className="font-semibold">Triggers</h4>
      {workspace.isError && <p role="alert" className="error">{workspace.error.message}</p>}
      {zones.isError && <p role="alert" className="error">{zones.error.message}</p>}
      {zones.isSuccess && !zones.data.length && <p className="text-sm text-slate-600">Draw a loading zone to create a trigger.</p>}
      {!!zones.data?.length && <form className="grid gap-3" onSubmit={submitDraft}>
        <div className="field">
          <Label htmlFor="trigger-zone">Loading zone</Label>
          <select id="trigger-zone" name="zoneId" className="h-9 rounded-md border bg-background px-3 text-sm" required>
            <option value="">Select a zone</option>
            {zones.data.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
          </select>
        </div>
        <div className="field">
          <Label htmlFor="trigger-description">Describe the trigger</Label>
          <textarea id="trigger-description" name="description" rows={2} maxLength={1000} required
            className="w-full rounded-md border bg-background px-3 py-2 text-sm"
            placeholder="Flag a forklift that stays in this zone for five minutes." />
        </div>
        <Button type="submit" variant="outline" className="justify-self-start" disabled={draft.isPending}>
          {draft.isPending ? 'Interpreting…' : 'Interpret request'}
        </Button>
        {draft.error && <p role="alert" className="error">{draft.error.message}</p>}
        {draft.data && <p role="status" className="text-sm text-slate-600">{draft.data.explanation}</p>}
      </form>}
      {toggle.error && <p role="alert" className="error">{toggle.error.message}</p>}
      {workspace.data?.analysisConfigured === false && <p role="status" className="text-sm text-slate-600">
        Recording analysis is unavailable until a detector is configured. Unanalyzed footage leaves dwell undecided.
      </p>}
      {workspace.isPending && <p role="status" className="text-sm text-slate-600">Loading triggers…</p>}
      {!!workspace.data?.triggers.length && <ul className="grid gap-3">
        {workspace.data.triggers.map((trigger) => (
          <li key={trigger.id}>
            <TriggerReview cameraId={cameraId} trigger={trigger} initiallyOpen={trigger.id === draftId}
              disabled={toggle.isPending} onToggle={(enabled) => toggle.mutate({ id: trigger.id, enabled })} />
          </li>
        ))}
      </ul>}
      <section className="grid gap-3" aria-labelledby="trigger-history">
        <h5 id="trigger-history" className="font-semibold">Trigger History</h5>
        {workspace.isSuccess && !workspace.data.history.length && <p className="text-sm text-slate-600">No trigger events yet.</p>}
        {!!workspace.data?.history.length && <ul className="grid gap-3">
          {workspace.data.history.map((event) => <li key={event.id}>
            <MatchEvidence cameraId={cameraId} match={event} eventId={event.id} title={`${timestamp(event.occurrenceMs)} · ${event.condition.zone.name}`}>
              <p className="text-sm">{conditionText(event.condition)}</p>
            </MatchEvidence>
          </li>)}
        </ul>}
      </section>
    </section>
  );
}

function TriggerReview({ cameraId, trigger, initiallyOpen, disabled, onToggle }: {
  cameraId: string; trigger: Trigger; initiallyOpen: boolean; disabled: boolean; onToggle: (enabled: boolean) => void;
}) {
  const inputId = useId();
  const [range, setRange] = useState(() => {
    const now = Date.now();
    return { start: localTimeInput(now - 15 * 60_000), end: localTimeInput(now) };
  });
  const preview = useMutation({
    mutationFn: () => triggerApi.preview(cameraId, trigger.id, {
      startMs: new Date(range.start).getTime(), endMs: new Date(range.end).getTime(),
    }),
  });

  return (
    <details className="rounded-md border p-3" open={initiallyOpen || undefined}>
      <summary className="cursor-pointer font-medium">
        {trigger.condition.zone.name} · 5-minute forklift dwell · {trigger.activeSince ? 'Enabled' : trigger.reviewed ? 'Disabled' : 'Review draft'}
      </summary>
      <div className="mt-3 grid gap-3 text-sm">
        <p>{conditionText(trigger.condition)}</p>
        <p className="text-slate-600">
          {trigger.condition.zone.ground ? 'Membership uses the estimated wheel position.' : 'Membership uses overlap with the drawn image zone.'}{' '}
          {' '}An obscured forklift, uncertain identity, or missing analysis can leave a dwell undecided.
          {!!trigger.condition.supportingViews?.length && (
            <> Overlapping footage from {trigger.condition.supportingViews.length} calibrated {trigger.condition.supportingViews.length === 1 ? 'view can' : 'views can'} help establish continuity.</>
          )}
          Monitoring uses this saved zone outline and starts a fresh window each time you enable it.
        </p>
        {trigger.activeSince && <p>Enabled since {timestamp(Date.parse(trigger.activeSince))}</p>}
        <Button type="button" size="sm" variant={trigger.activeSince ? 'outline' : 'default'}
          className="justify-self-start" disabled={disabled} onClick={() => onToggle(!trigger.activeSince)}>
          {trigger.activeSince ? 'Disable trigger' : trigger.reviewed ? 'Enable trigger' : 'Confirm condition and enable'}
        </Button>
        <form className="grid gap-3 border-t pt-3" onSubmit={(event) => { event.preventDefault(); preview.mutate(); }}>
          <p className="font-medium">Historical preview</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="field">
              <Label htmlFor={`${inputId}-from`}>From (local time)</Label>
              <Input id={`${inputId}-from`} type="datetime-local" step={1} required value={range.start}
                onChange={(event) => { setRange({ ...range, start: event.target.value }); preview.reset(); }} />
            </div>
            <div className="field">
              <Label htmlFor={`${inputId}-to`}>To (local time)</Label>
              <Input id={`${inputId}-to`} type="datetime-local" step={1} required value={range.end}
                onChange={(event) => { setRange({ ...range, end: event.target.value }); preview.reset(); }} />
            </div>
          </div>
          <Button type="submit" size="sm" variant="outline" className="justify-self-start" disabled={preview.isPending}>
            {preview.isPending ? 'Evaluating…' : 'Preview on recorded footage'}
          </Button>
        </form>
        {preview.error && <p role="alert" className="error">{preview.error.message}</p>}
        {preview.data && <div className="grid gap-2">
          <p role="status">{preview.data.matches.length} hypothetical {preview.data.matches.length === 1 ? 'match' : 'matches'}</p>
          {preview.data.matches.map((match, index) =>
            <MatchEvidence key={`${match.occurrenceMs}-${index}`} cameraId={cameraId} match={match} title={timestamp(match.occurrenceMs)} />)}
          {!!preview.data.undecided.length && <>
            <p className="font-medium">Undecided intervals</p>
            <ul className="max-h-48 list-disc space-y-1 overflow-auto pl-5">
              {preview.data.undecided.map(({ startMs, endMs }) => <li key={startMs}>{timestamp(startMs)} – {timestamp(endMs)}</li>)}
            </ul>
          </>}
        </div>}
      </div>
    </details>
  );
}

function MatchEvidence({ cameraId, match, eventId, title, children }: {
  cameraId: string; match: DwellMatch; eventId?: string; title: string; children?: React.ReactNode;
}) {
  const [clip, setClip] = useState<number>();
  const [error, setError] = useState(false);
  const clips = [...match.evidence, ...(match.supportingEvidence ?? [])];
  const selected = clip === undefined ? undefined : clips[clip];
  const playbackUrl = selected && (eventId
    ? triggerApi.evidence(cameraId, eventId, selected.recordingId)
    : cameraApi.recording(selected.cameraId ?? cameraId, selected.recordingId));
  const clipLabel = (index: number) => index === 0 ? 'entry' : index === 1 ? 'dwell evidence' : `overlap evidence ${index - 1}`;
  return (
    <details className="rounded-md border p-3">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <div className="mt-3 grid gap-3">
        {children}
        <div className="flex flex-wrap gap-2">
          {clips.map((item, index) =>
            <Button key={`${item.recordingId}-${index}`} type="button" size="sm" variant="outline" aria-pressed={clip === index}
              onClick={() => { setError(false); setClip(index); }}>Play {clipLabel(index)}</Button>)}
        </div>
        {clip !== undefined && selected && playbackUrl && <video key={clip} className="w-full rounded-md bg-black"
          src={`${playbackUrl}#t=${selected.offsetMs / 1000}`}
          aria-label={`Forklift ${clipLabel(clip)} footage`}
          controls playsInline autoPlay preload="metadata" onError={() => setError(true)} />}
        {error && <p className="error" role="alert">Evidence footage is unavailable.</p>}
      </div>
    </details>
  );
}
