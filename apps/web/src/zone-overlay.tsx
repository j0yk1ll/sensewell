import { lazy, Suspense, type ComponentProps } from 'react';

const ZoneCanvas = lazy(() => import('./zone-canvas'));

export function ZoneOverlay(props: ComponentProps<typeof ZoneCanvas>) {
  return (
    <Suspense fallback={null}>
      <ZoneCanvas {...props} />
    </Suspense>
  );
}
