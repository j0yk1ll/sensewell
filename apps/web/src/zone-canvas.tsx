import type { CameraZone, ZonePoint } from '@sensewell/contracts';
import 'konva/lib/shapes/Circle.js';
import 'konva/lib/shapes/Line.js';
import 'konva/lib/shapes/Text.js';
import { useLayoutEffect, useState, type KeyboardEvent, type RefObject } from 'react';
import { Circle, Layer, Line, Stage, Text } from 'react-konva/lib/ReactKonvaCore.js';

type Size = { width: number; height: number };

const arrowSteps: Partial<Record<string, ZonePoint>> = {
  ArrowLeft: { x: -0.02, y: 0 },
  ArrowRight: { x: 0.02, y: 0 },
  ArrowUp: { x: 0, y: -0.02 },
  ArrowDown: { x: 0, y: 0.02 },
};

function clampCoordinate(value: number) {
  return Math.min(1, Math.max(0, value));
}

export default function ZoneCanvas({ footage, sourceSize, zones, draft, drawingArea }: {
  footage: RefObject<HTMLDivElement | null>;
  sourceSize: Size;
  zones: CameraZone[];
  draft?: { points: ZonePoint[]; saving: boolean; onPoint: (point: ZonePoint) => void };
  drawingArea?: RefObject<HTMLDivElement | null>;
}) {
  const [footageSize, setFootageSize] = useState<Size>();
  const [cursor, setCursor] = useState<ZonePoint>({ x: 0.5, y: 0.5 });
  const [keyboardCursor, setKeyboardCursor] = useState(false);
  const drawing = draft && !draft.saving;
  const points = draft?.points ?? [];

  useLayoutEffect(() => {
    const element = footage.current;
    if (!element) return;
    function measure({ width, height }: Size) {
      setFootageSize({ width, height });
    }
    measure(element.getBoundingClientRect());
    const observer = new ResizeObserver(([entry]) => {
      if (entry) measure(entry.contentRect);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [footage]);

  const scale = footageSize
    ? Math.min(footageSize.width / sourceSize.width, footageSize.height / sourceSize.height)
    : 0;
  const width = sourceSize.width * scale;
  const height = sourceSize.height * scale;
  const hasImage = width > 0 && height > 0;

  useLayoutEffect(() => {
    if (drawing && hasImage) drawingArea?.current?.focus();
  }, [drawing, drawingArea, hasImage]);

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!event.repeat) draft?.onPoint(cursor);
      setKeyboardCursor(true);
      return;
    }
    const step = arrowSteps[event.key];
    if (!step) return;
    event.preventDefault();
    setKeyboardCursor(true);
    setCursor(({ x, y }) => ({ x: clampCoordinate(x + step.x), y: clampCoordinate(y + step.y) }));
  }

  if (!footageSize || !hasImage) return null;

  function toPixels({ x, y }: ZonePoint) {
    return { x: x * width, y: y * height };
  }

  function outlinePixels(outline: ZonePoint[]) {
    return outline.map(toPixels).flatMap(({ x, y }) => [x, y]);
  }

  return (
    <div ref={drawingArea} className={`absolute ${drawing ? 'cursor-crosshair touch-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white' : 'pointer-events-none'}`}
      style={{ top: (footageSize.height - height) / 2, left: (footageSize.width - width) / 2 }}
      tabIndex={drawing ? 0 : undefined} role={drawing ? 'group' : undefined}
      aria-label={drawing ? 'Zone drawing area' : undefined} aria-describedby={drawing ? 'zone-drawing-instructions' : undefined}
      aria-hidden={drawing ? undefined : true} onKeyDown={drawing ? handleKey : undefined}
      onBlur={() => setKeyboardCursor(false)}>
      <Stage width={width} height={height} onPointerClick={drawing ? (event) => {
        if (!event.evt.isPrimary || event.evt.button !== 0) return;
        const pointer = event.target.getStage()?.getPointerPosition();
        if (!pointer) return;
        const point = { x: clampCoordinate(pointer.x / width), y: clampCoordinate(pointer.y / height) };
        setKeyboardCursor(false);
        setCursor(point);
        draft.onPoint(point);
      } : undefined}>
        <Layer listening={false}>
          {zones.map(({ id, points }) => <Line key={id} points={outlinePixels(points)} closed fill="rgba(52, 211, 153, 0.25)"
            stroke="#6ee7b7" strokeWidth={2} />)}
          {zones.map(({ id, name, points }) => {
            const corner = points[0];
            if (!corner) return null;
            const { x, y } = toPixels(corner);
            return <Text key={id} text={name} fontSize={13} fontStyle="bold" fill="white"
              stroke="#022c22" strokeWidth={3} fillAfterStrokeEnabled ellipsis wrap="none"
              width={Math.min(width, 180)} x={Math.max(0, Math.min(x, width - 180))}
              y={Math.max(0, y - 17)} />;
          })}
          {points.length > 0 && <Line points={outlinePixels(points)} closed={points.length >= 3}
            stroke="#fbbf24" strokeWidth={2} dash={[6, 4]} fill="rgba(251, 191, 36, 0.2)" />}
          {points.map((point, index) => <Circle key={index} {...toPixels(point)}
            radius={4} fill="#fbbf24" stroke="#422006" strokeWidth={1} />)}
          {drawing && keyboardCursor && <Circle {...toPixels(cursor)}
            radius={7} stroke="white" strokeWidth={2} shadowColor="black" shadowBlur={3} shadowOpacity={1} />}
        </Layer>
      </Stage>
    </div>
  );
}
