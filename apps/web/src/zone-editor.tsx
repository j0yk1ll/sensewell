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

export function ZoneEditor({ id, tenantId, sourceSize, children, timeline }: {
  id: string;
  tenantId: string;
  sourceSize?: { width: number; height: number };
  children: ReactNode;
  timeline: ReactNode;
}) {
  const footage = useRef<HTMLDivElement>(null);
  const drawButton = useRef<HTMLButtonElement>(null);
  const queryClient = useQueryClient();
  const query = cameraZoneQuery(id, tenantId);
  const zones = useQuery(query);
  const [drawing, setDrawing] = useState(false);
  const [points, setPoints] = useState<ZonePoint[]>([]);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const restoreFocus = useRef(false);

  useLayoutEffect(() => {
    if (!drawing && restoreFocus.current) {
      drawButton.current?.focus();
      restoreFocus.current = false;
    }
  }, [drawing]);

  function finishDrawing() {
    restoreFocus.current = true;
    setDrawing(false);
    setPoints([]);
    setError('');
  }

  const save = useMutation({
    mutationFn: (zone: CameraZoneInput) => cameraApi.addZone(id, zone),
    onSuccess: (zone) => {
      queryClient.setQueryData<CameraZone[]>(query.queryKey, (saved = []) =>
        saved.some(({ id }) => id === zone.id) ? saved : [...saved, zone]);
      finishDrawing();
      setMessage(`Saved ${zone.name}.`);
      void queryClient.invalidateQueries({ queryKey: query.queryKey });
    },
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!sourceSize || save.isPending) return;
    const name = new FormData(event.currentTarget).get('name');
    const zone = cameraZoneInput.safeParse({ name, points });
    if (!zone.success) {
      setError(zone.error.issues[0]?.path[0] === 'name'
        ? 'Enter a zone name.'
        : 'Draw an outline with at least three distinct corners and edges that do not cross.');
      return;
    }
    setError('');
    save.mutate(zone.data);
  }

  function addPoint(point: ZonePoint) {
    setError('');
    setPoints((current) => current.length < maxZonePoints ? [...current, point] : current);
  }

  return (
    <div className="footage-with-timeline footage-with-zones grid">
      <div ref={footage} className="footage" onContextMenu={(event) => event.preventDefault()}>
        {children}
        {sourceSize && (drawing || !!zones.data?.length) && <ZoneOverlay
          footage={footage} sourceSize={sourceSize} zones={zones.data ?? []}
          draft={drawing ? { points, onPoint: addPoint, saving: save.isPending } : undefined}
        />}
      </div>
      {timeline}
      <section aria-labelledby="camera-zones-title" className="grid gap-3 border-b border-slate-200 px-5 py-4 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h4 id="camera-zones-title" className="font-semibold">Zones</h4>
          {!drawing && <Button ref={drawButton} type="button" variant="outline" disabled={!sourceSize || !zones.data}
            onClick={() => {
              save.reset();
              setMessage('');
              setDrawing(true);
            }}>Draw zone</Button>}
        </div>
        {zones.isPending && <p role="status" className="text-sm text-slate-600">Loading zones…</p>}
        {zones.isError && <div className="flex flex-wrap items-center gap-2">
          <p className="error" role="alert">{zones.error.message}</p>
          <Button type="button" variant="outline" onClick={() => void zones.refetch()}>Retry</Button>
        </div>}
        {zones.data && (zones.data.length > 0
          ? <ul className="flex flex-wrap gap-2 text-sm">
            {zones.data.map((zone) => <li key={zone.id} className="rounded-md bg-emerald-50 px-2.5 py-1 text-emerald-900 wrap-anywhere">
              {zone.name}
            </li>)}
          </ul>
          : !drawing && <p className="text-sm text-slate-600">No saved zones.</p>)}
        {drawing && <form className="grid gap-3" onSubmit={submit}>
          <p id="zone-drawing-instructions" className="text-sm text-slate-600">
            Click or tap each corner on the preview. With the drawing area focused, use arrow keys to move the cursor
            and Enter to place a corner.
          </p>
          <p role="status" className="text-sm text-slate-600">
            {points.length} {points.length === 1 ? 'corner' : 'corners'} placed
            {points.length === maxZonePoints ? ' (limit reached)' : ''}
          </p>
          <div className="field">
            <Label htmlFor="zone-name">Zone name</Label>
            <Input id="zone-name" name="name" required maxLength={maxZoneNameLength} disabled={save.isPending} />
          </div>
          {(error || save.isError) && <p className="error" role="alert">{error || save.error?.message}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={!sourceSize || points.length < 3 || save.isPending}>
              {save.isPending ? 'Saving zone…' : 'Save zone'}
            </Button>
            <Button type="button" variant="outline" disabled={!points.length || save.isPending}
              onClick={() => {
                setError('');
                setPoints((current) => current.slice(0, -1));
              }}>Undo corner</Button>
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={finishDrawing}>Cancel</Button>
          </div>
        </form>}
        {message && <p role="status" className="text-sm text-slate-600">{message}</p>}
      </section>
    </div>
  );
}
