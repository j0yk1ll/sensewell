import {
  cameraZoneInput, maxZoneNameLength, maxZonePoints, type CameraZone, type CameraZoneInput, type ZonePoint,
} from '@sensewell/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cameraApi, cameraZoneQuery } from './camera-api';
import { ZoneOverlay } from './zone-overlay';

type ZoneDraft = CameraZoneInput & { zoneId?: string };

export function ZoneEditor({ id, tenantId, sourceSize, children, timeline }: {
  id: string;
  tenantId: string;
  sourceSize?: { width: number; height: number };
  children: ReactNode;
  timeline?: ReactNode;
}) {
  const footage = useRef<HTMLDivElement>(null);
  const drawingArea = useRef<HTMLDivElement>(null);
  const drawButton = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const query = cameraZoneQuery(id, tenantId);
  const zones = useQuery(query);
  const [draft, setDraft] = useState<ZoneDraft>();
  const [removing, setRemoving] = useState<CameraZone>();
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const returnFocus = useRef<HTMLButtonElement>(null);
  const cancelRemove = useRef<HTMLButtonElement>(null);
  const visibleZones = zones.data?.filter((zone) => zone.id !== draft?.zoneId) ?? [];

  useLayoutEffect(() => {
    if (removing) {
      cancelRemove.current?.focus();
    } else if (!draft && returnFocus.current) {
      const target = returnFocus.current.isConnected ? returnFocus.current : drawButton.current;
      target?.focus();
      returnFocus.current = null;
    }
  }, [draft, removing]);

  function finishDrawing() {
    setDraft(undefined);
    setError('');
  }

  function refreshZones() {
    void queryClient.invalidateQueries({ queryKey: query.queryKey });
  }

  const save = useMutation({
    mutationFn: ({ zoneId, ...zone }: ZoneDraft) =>
      zoneId ? cameraApi.updateZone(id, zoneId, zone) : cameraApi.addZone(id, zone),
    onMutate: () => queryClient.cancelQueries({ queryKey: query.queryKey }),
    onSuccess: (zone) => {
      queryClient.setQueryData<CameraZone[]>(query.queryKey, (saved = []) =>
        saved.some(({ id }) => id === zone.id) ? saved.map((entry) => entry.id === zone.id ? zone : entry) : [...saved, zone]);
      finishDrawing();
      setMessage(`Saved ${zone.name}.`);
    },
    onSettled: refreshZones,
  });

  const remove = useMutation({
    mutationFn: (zone: CameraZone) => cameraApi.removeZone(id, zone.id),
    onMutate: () => queryClient.cancelQueries({ queryKey: query.queryKey }),
    onSuccess: (_, zone) => {
      queryClient.setQueryData<CameraZone[]>(query.queryKey, (saved = []) =>
        saved.filter((entry) => entry.id !== zone.id));
      setRemoving(undefined);
      setMessage(`Removed ${zone.name}.`);
    },
    onSettled: refreshZones,
  });

  function beginDrawing(button: HTMLButtonElement, zone?: CameraZone) {
    returnFocus.current = button;
    save.reset();
    setMessage('');
    setDraft(zone ? { zoneId: zone.id, name: zone.name, points: zone.points } : { name: '', points: [] });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || !sourceSize || save.isPending) return;
    const { name, points, zoneId } = draft;
    const zone = cameraZoneInput.safeParse({ name, points });
    if (!zone.success) {
      setError(zone.error.issues[0]?.path[0] === 'name'
        ? 'Enter a zone name.'
        : 'Draw an outline with at least three distinct corners and edges that do not cross.');
      return;
    }
    setError('');
    save.mutate({ ...zone.data, zoneId });
  }

  function addPoint(point: ZonePoint) {
    setError('');
    setDraft((current) => current && current.points.length < maxZonePoints
      ? { ...current, points: [...current.points, point] }
      : current);
  }

  return (
    <div className="footage-with-timeline footage-with-zones grid">
      <div ref={footage} className="footage" onContextMenu={(event) => event.preventDefault()}>
        {children}
        {sourceSize && (draft || visibleZones.length > 0) && <ZoneOverlay
          footage={footage} sourceSize={sourceSize} zones={visibleZones} drawingArea={drawingArea}
          draft={draft ? { points: draft.points, onPoint: addPoint, saving: save.isPending } : undefined}
        />}
      </div>
      {timeline}
      <section aria-labelledby="camera-zones-title" className="grid gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id="camera-zones-title" className="font-semibold">Zones</h4>
          {!draft && <Button ref={drawButton} type="button" variant="outline" disabled={!sourceSize || !zones.data || !!removing}
            onClick={(event) => beginDrawing(event.currentTarget)}>Draw zone</Button>}
        </div>
        {zones.isPending && <p role="status" className="text-sm text-slate-600">Loading zones…</p>}
        {zones.isError && <div className="flex flex-wrap items-center gap-2">
          <p className="error" role="alert">{zones.error.message}</p>
          <Button type="button" variant="outline" onClick={() => void zones.refetch()}>Retry</Button>
        </div>}
        {zones.data && (zones.data.length > 0
          ? <ul className="divide-y divide-slate-200 rounded-md border border-slate-200 text-sm">
            {zones.data.map((zone) => (
              <li key={zone.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3 py-2">
                <span className="min-w-0 font-medium text-emerald-900 wrap-anywhere">{zone.name}</span>
                <div className="flex flex-wrap gap-1">
                  <Button type="button" variant="ghost" size="sm" disabled={!sourceSize || !!draft || !!removing}
                    aria-label={`Edit ${zone.name}`} onClick={(event) => beginDrawing(event.currentTarget, zone)}>Edit</Button>
                  <Button type="button" variant="ghost" size="sm" disabled={!!draft || !!removing}
                    aria-label={`Remove ${zone.name}`} onClick={(event) => {
                      returnFocus.current = event.currentTarget;
                      remove.reset();
                      setMessage('');
                      setRemoving(zone);
                    }}>Remove</Button>
                </div>
              </li>
            ))}
          </ul>
          : !draft && <p className="text-sm text-slate-600">No saved zones.</p>)}
        {removing && <div className="grid gap-2 rounded-md border border-slate-200 p-3" role="group"
          aria-labelledby="remove-zone-title">
          <p id="remove-zone-title" className="text-sm font-medium wrap-anywhere">Remove {removing.name}?</p>
          {remove.isError && <p className="error" role="alert">{remove.error.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button ref={cancelRemove} type="button" variant="outline" disabled={remove.isPending}
              onClick={() => setRemoving(undefined)}>Cancel</Button>
            <Button type="button" variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(removing)}>
              {remove.isPending ? 'Removing…' : 'Remove zone'}
            </Button>
          </div>
        </div>}
        {draft && <form className="grid gap-3" onSubmit={submit}>
          {draft.zoneId && <h5 className="font-medium">Edit zone</h5>}
          <p id="zone-drawing-instructions" className="text-sm text-slate-600">
            Click or tap each corner on the preview. With the drawing area focused, use arrow keys to move the cursor
            and Enter to place a corner.
          </p>
          <p role="status" className="text-sm text-slate-600">
            {draft.points.length} {draft.points.length === 1 ? 'corner' : 'corners'} placed
            {draft.points.length === maxZonePoints ? ' (limit reached)' : ''}
          </p>
          <div className="field">
            <Label htmlFor="zone-name">Zone name</Label>
            <Input id="zone-name" name="name" required maxLength={maxZoneNameLength} disabled={save.isPending}
              value={draft.name} onChange={({ currentTarget: { value } }) => {
                setError('');
                setDraft((current) => current && { ...current, name: value });
              }} />
          </div>
          {(error || save.isError) && <p className="error" role="alert">{error || save.error?.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!sourceSize || draft.points.length < 3 || save.isPending}>
              {save.isPending ? 'Saving zone…' : draft.zoneId ? 'Save changes' : 'Save zone'}
            </Button>
            <Button type="button" variant="outline" disabled={!draft.points.length || save.isPending}
              onClick={() => {
                setError('');
                setDraft((current) => current && { ...current, points: current.points.slice(0, -1) });
              }}>Undo corner</Button>
            {draft.zoneId && <Button type="button" variant="outline" disabled={!draft.points.length || save.isPending}
              onClick={() => {
                setError('');
                setDraft((current) => current && { ...current, points: [] });
                drawingArea.current?.focus();
              }}>Redraw outline</Button>}
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={finishDrawing}>Cancel</Button>
          </div>
        </form>}
        {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
      </section>
    </div>
  );
}
