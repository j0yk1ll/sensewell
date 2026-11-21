import type { ActivityChatSource, ActivityQuery, CameraZone, ObjectDetection, ZoneActivityFrame } from '@sensewell/contracts';
import { replayFrameIntervalMs } from './replay-source.js';
import { summarizeZoneActivity } from './zone-activity.js';
import { ZoneEntryEvaluator } from './zone-entry.js';

type Observation = { sourceMs: number; detections: (Pick<ObjectDetection, 'box' | 'confidence'> & { objectType?: string })[] };
type Sample = ZoneActivityFrame['rules'][number]['visits'][number]['lastInside'];
type Source = Pick<ActivityChatSource, 'cameraId' | 'cameraName' | 'passId' | 'passNumber' | 'passStartedAt' | 'active'>;

const evidenceLimit = 12;

function sampleEvidence(sample: Sample | null) {
  return sample && { sourceMs: sample.sourceMs, confidence: sample.detection.confidence };
}

export function investigateActivity(
  source: Source, durationMs: number, observations: Observation[], zones: CameraZone[], query: ActivityQuery,
) {
  const { fromMs = 0, toMs = durationMs, atMs, minimumConfidence = 0.5, includePossible = false, objectType = 'person' } = query;
  const inRange = (ms: number) => ms >= fromMs && ms <= toMs;
  const first = observations[0];
  const last = observations.at(-1);
  const coverage = first && last ? { firstMs: first.sourceMs, lastMs: last.sourceMs } : null;
  const evaluator = new ZoneEntryEvaluator();
  const rules = zones.map(({ id, name, points }) => ({
    id, name, zoneName: name, points, revision: 0, minimumConfidence, objectTypes: [objectType], eventType: 'both' as const,
  }));
  const analysisGaps: { afterMs: number; beforeMs: number }[] = [];
  const frames = [];
  let previousMs: number | undefined;
  for (const { sourceMs, detections } of observations) {
    if (previousMs !== undefined && sourceMs - previousMs > replayFrameIntervalMs) {
      if (previousMs < toMs && sourceMs > fromMs) analysisGaps.push({ afterMs: previousMs, beforeMs: sourceMs });
    }
    if (sourceMs > toMs) break;
    frames.push({
      sourceMs,
      evidence: evaluator.evaluate(sourceMs, detections.flatMap(({ box, confidence, objectType: recordedType }) =>
        (recordedType ?? 'person') === objectType ? [{ box, confidence, objectType }] : []), rules).evidence,
    });
    previousMs = sourceMs;
  }

  const windowEndsEarly = coverage !== null && toMs < coverage.lastMs;
  const { rules: activity } = summarizeZoneActivity(source.passId, frames, source.active || windowEndsEarly, atMs, coverage?.lastMs);
  const timestamps = new Set<number>();
  const zoneResults = activity.map(({ zoneName, crossings, occupancy, visits, gaps }, index) => {
    const detailLimit = index < evidenceLimit ? evidenceLimit : 0;
    const relevantCrossings = crossings.filter(({ after }) => inRange(after.sourceMs));
    const confirmed = relevantCrossings.filter(({ direction, certainty }) => direction === 'entry' && certainty === 'confirmed');
    const possible = relevantCrossings.filter(({ direction, certainty }) => direction === 'entry' && certainty === 'possible');
    const included = includePossible ? [...confirmed, ...possible] : confirmed;
    const relevantVisits = visits.filter(({ firstInside, lastInside, exit }) =>
      firstInside.sourceMs <= toMs && (exit ?? lastInside).sourceMs >= fromMs)
      .map((visit) => {
        const { entry, exit } = visit;
        const dwellMs = entry && exit && inRange(entry.sourceMs) && inRange(exit.sourceMs)
          ? exit.sourceMs - entry.sourceMs : null;
        return { ...visit, dwellMs };
      });
    const complete = relevantVisits.filter(({ dwellMs }) => dwellMs !== null);
    const partial = relevantVisits.filter(({ dwellMs }) => dwellMs === null);
    const crossingEvidence = relevantCrossings.filter(({ certainty }) => includePossible || certainty === 'confirmed')
      .slice(0, detailLimit).map(({ trackId, direction, certainty, before, after }) => {
        timestamps.add(after.sourceMs);
        timestamps.add(before.sourceMs);
        return { trackId, direction, certainty, before: sampleEvidence(before), after: sampleEvidence(after) };
      });
    const visitEvidence = [...complete, ...partial].slice(0, detailLimit).map((visit) => {
      const { trackId, state, reason, entry, exit, firstInside, lastInside, dwellMs } = visit;
      timestamps.add(firstInside.sourceMs);
      timestamps.add((exit ?? lastInside).sourceMs);
      return {
        trackId, state: dwellMs === null && state === 'complete' ? 'partial' : state, reason, dwellMs,
        entry: sampleEvidence(entry), exit: sampleEvidence(exit),
        firstInside: sampleEvidence(firstInside), lastInside: sampleEvidence(lastInside),
      };
    });
    const observed = occupancy && (atMs !== undefined || inRange(occupancy.sourceMs)) ? occupancy : null;
    if (observed) timestamps.add(observed.sourceMs);
    const relevantGaps = gaps.filter(({ startMs, endMs }) => startMs <= toMs && (endMs === null || endMs >= fromMs));
    return {
      zoneName,
      confirmedEntries: confirmed.length,
      possibleEntries: possible.length,
      estimatedDistinctEntrants: new Set(included.map(({ trackId }) => trackId)).size,
      occupancy: observed && {
        sourceMs: observed.sourceMs, observed: observed.inside.length, unknown: observed.unknownTrackIds.length,
      },
      completeVisits: complete.length,
      averageCompleteDwellMs: complete.length
        ? complete.reduce((sum, { dwellMs }) => sum + (dwellMs ?? 0), 0) / complete.length
        : null,
      partialOrOpenVisits: partial.length,
      visits: visitEvidence,
      crossings: crossingEvidence,
      observationGapCount: relevantGaps.length,
      observationGaps: relevantGaps.slice(0, detailLimit),
    };
  });
  // Replay samples stop before the end of the clip. A completed pass may cover the
  // requested range even though its final sample lands just before the end.
  const incomplete = !coverage || fromMs < coverage.firstMs || fromMs > coverage.lastMs
    || analysisGaps.length > 0 || toMs > durationMs
    || (source.active ? toMs > coverage.lastMs : Math.min(toMs, durationMs - 1) >= coverage.lastMs + replayFrameIntervalMs)
    || (atMs !== undefined && (atMs < coverage.firstMs || atMs > coverage.lastMs));
  const citation: ActivityChatSource = {
    ...source, fromMs, toMs, coverage, incomplete,
    timestamps: [...timestamps].slice(0, evidenceLimit).sort((a, b) => a - b),
  };
  return {
    source: citation, occupancyRequestedAtMs: atMs ?? null, minimumConfidence, includePossible, objectType,
    analysisGapCount: analysisGaps.length, analysisGaps: analysisGaps.slice(0, evidenceLimit),
    zoneCount: activity.length, zones: zoneResults,
  };
}
