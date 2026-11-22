import type { GroundDecision } from '@sensewell/contracts';
import { lazy, Suspense, type ComponentProps } from 'react';

const ZoneCanvas = lazy(() => import('./zone-canvas'));

export function ZoneOverlay(props: ComponentProps<typeof ZoneCanvas>) {
  return (
    <Suspense fallback={null}>
      <ZoneCanvas {...props} />
    </Suspense>
  );
}

export function DetectionBox({ box: [left, top, right, bottom] }: { box: [number, number, number, number] }) {
  return <div aria-hidden="true" className="pointer-events-none absolute border-2 border-amber-300 shadow-[0_0_0_1px_#020617]"
    style={{ left: `${left * 100}%`, top: `${top * 100}%`, width: `${(right - left) * 100}%`, height: `${(bottom - top) * 100}%` }} />;
}

const uncertainty = {
  'ground-obscured': 'Ground contact obscured or unavailable',
  'near-boundary': 'Within the boundary tolerance',
  'projection-unavailable': 'Floor projection unavailable',
  'unsupported-object': 'Ground reference unavailable for this object type',
};

export function GroundMarkers({ decision }: { decision: GroundDecision }) {
  return decision.points.map(({ image, floor }, index) => <span key={index} aria-hidden="true"
    title={`Floor position ${floor.x.toFixed(2)}, ${floor.y.toFixed(2)} m`}
    className={`pointer-events-none absolute z-10 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-950 ${
      decision.state === 'unknown' ? 'bg-amber-300' : 'bg-sky-200'
    }`}
    style={{ left: `${image.x * 100}%`, top: `${image.y * 100}%` }} />);
}

export function GroundPositionDescription({ decision }: { decision: GroundDecision }) {
  const points = decision.points.map(({ floor }) => `(${floor.x.toFixed(2)}, ${floor.y.toFixed(2)}) m`).join(' · ');
  return <span>
    {decision.state === 'unknown' ? 'Zone state unknown' : decision.state === 'inside' ? 'Inside zone' : 'Outside zone'}
    {decision.reason && ` · ${uncertainty[decision.reason]}`}
    {decision.points.length > 0 && ` · ${decision.method === 'ankles' ? 'Ankles' : 'Estimated wheel line'} ${points}`}
  </span>;
}
