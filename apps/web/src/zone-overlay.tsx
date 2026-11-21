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
