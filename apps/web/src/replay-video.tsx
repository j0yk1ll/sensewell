import { useQuery } from '@tanstack/react-query';
import { warehouseObjectLabels, type ReplayImage } from '@sensewell/contracts';
import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { cameraApi, cameraZoneQuery } from './camera-api';
import { ZoneOverlay } from './zone-overlay';

type FrameDetails = Omit<ReplayImage, 'jpeg'>;

function paintFrame(source: HTMLCanvasElement, overlay: HTMLCanvasElement, bitmap: ImageBitmap, frame: FrameDetails) {
  const { width, height } = bitmap;
  const picture = source.getContext('2d');
  const annotations = overlay.getContext('2d');
  if (!picture || !annotations) throw new Error('Replay canvas is unavailable.');
  if (source.width !== width || source.height !== height) {
    source.width = overlay.width = width;
    source.height = overlay.height = height;
  }
  picture.drawImage(bitmap, 0, 0);
  annotations.clearRect(0, 0, width, height);
  if (frame.analysis.state !== 'analyzed') return;

  annotations.font = `bold ${Math.max(14, width / 48)}px system-ui`;
  annotations.lineJoin = 'round';
  for (const { box: [left, top, right, bottom], confidence, objectType } of frame.analysis.detections) {
    const x = left * width;
    const y = top * height;
    const boxWidth = (right - left) * width;
    const boxHeight = (bottom - top) * height;
    annotations.lineWidth = 5;
    annotations.strokeStyle = '#020617';
    annotations.strokeRect(x, y, boxWidth, boxHeight);
    annotations.lineWidth = 2;
    annotations.strokeStyle = '#fcd34d';
    annotations.strokeRect(x, y, boxWidth, boxHeight);

    const label = `${warehouseObjectLabels[objectType]} ${Math.round(confidence * 100)}%`;
    const labelX = Math.max(2, Math.min(x + 2, width - annotations.measureText(label).width - 3));
    const labelY = Math.max(22, y - 5);
    annotations.lineWidth = 4;
    annotations.strokeStyle = '#020617';
    annotations.strokeText(label, labelX, labelY);
    annotations.fillStyle = '#fcd34d';
    annotations.fillText(label, labelX, labelY);
  }
}

export function ReplayVideo({ id, tenantId, stopping, children }: {
  id: string; tenantId: string; stopping: boolean; children: (sourceMs: number) => React.JSX.Element;
}) {
  const footage = useRef<HTMLDivElement>(null);
  const source = useRef<HTMLCanvasElement>(null);
  const overlay = useRef<HTMLCanvasElement>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [frame, setFrame] = useState<FrameDetails>();
  const [sourceSize, setSourceSize] = useState<{ width: number; height: number }>();
  const [showDetections, setShowDetections] = useState(true);
  const detectionsId = useId();
  const zones = useQuery(cameraZoneQuery(id, tenantId));

  useEffect(() => {
    if (stopping) return;
    const abort = new AbortController();

    async function play() {
      let receivedFrame = false;
      try {
        for await (const { jpeg, ...frame } of cameraApi.replayFrames(id, abort.signal)) {
          const bytes = Uint8Array.from(atob(jpeg), (character) => character.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/jpeg' }));
          try {
            if (abort.signal.aborted || !source.current || !overlay.current) return;
            paintFrame(source.current, overlay.current, bitmap, frame);
            if (!receivedFrame) setSourceSize({ width: bitmap.width, height: bitmap.height });
            receivedFrame = true;
            setFrame(frame);
          } finally {
            bitmap.close();
          }
        }
        if (!receivedFrame && !abort.signal.aborted) setUnavailable(true);
      } catch {
        if (!abort.signal.aborted) setUnavailable(true);
      }
    }
    void play();
    return () => abort.abort();
  }, [id, attempt, stopping]);

  const showingFootage = !stopping && !unavailable && Boolean(frame);
  const detections = frame?.analysis.state === 'analyzed' ? frame.analysis.detections : [];
  const confidenceLabel = detections.map(({ confidence, objectType }) => `${warehouseObjectLabels[objectType]} ${Math.round(confidence * 100)}% confidence`).join(', ');
  const analysisStatus = {
    analyzed: detections.length === 0 ? 'No objects detected on this frame' : 'Object detections available',
    delayed: 'Analysis delayed for this frame',
    skipped: 'Frame skipped while the detector was busy',
    unavailable: 'Analysis unavailable for this frame',
  };

  return (
    <>
      <div ref={footage} className="footage">
        <canvas ref={source} className="replay-image" width={1} height={1} role="img" aria-label="Replay source footage"
          hidden={!showingFootage} />
        <canvas ref={overlay} className="replay-image pointer-events-none" width={1} height={1}
          role="img" aria-label={confidenceLabel} hidden={!showingFootage || !showDetections || !detections.length} />
        {showingFootage && sourceSize && !!zones.data?.length &&
          <ZoneOverlay footage={footage} sourceSize={sourceSize} zones={zones.data} />}
        {!frame && !stopping && !unavailable && <p className="footage-message" role="status">Loading replay footage…</p>}
        {stopping && <p className="footage-message">Closing replay footage…</p>}
        {!stopping && unavailable && <div className="footage-message">
          <p role="alert">Replay footage unavailable.</p>
          <Button type="button" variant="outline" className="mt-3" onClick={() => {
            setFrame(undefined);
            setSourceSize(undefined);
            setUnavailable(false);
            setAttempt(attempt + 1);
          }}>Retry replay footage</Button>
        </div>}
      </div>
      <div>
        {children(frame?.sourceMs ?? 0)}
        <div className="grid gap-2 border-b border-slate-200 bg-slate-50 px-5 py-3 text-sm text-slate-700 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="flex items-center gap-2">
              <Checkbox id={detectionsId} checked={showDetections}
                onCheckedChange={(checked) => setShowDetections(checked === true)} />
              <Label htmlFor={detectionsId}>Show object detections</Label>
            </div>
            <p>{showingFootage && frame ? analysisStatus[frame.analysis.state] : 'Waiting for replay analysis…'}</p>
          </div>
          {showingFootage && frame && <>
            <p className="tabular-nums">Pass {frame.passNumber} · {frame.analyzedFrames} of {frame.totalFrames} frames analyzed</p>
            <Progress aria-label="Frames analyzed" max={frame.totalFrames} value={frame.analyzedFrames} />
          </>}
        </div>
      </div>
    </>
  );
}
