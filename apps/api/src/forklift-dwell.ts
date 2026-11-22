import {
  boxOverlap, confirmationGapMs, type CameraZone, type DwellCandidate, type DwellRecording, type ForkliftDwellCondition,
  type ObjectDetection, type PublishedDwell, type RecordingObservation, type TriggerPreview, type TriggerRange, type ZonePoint,
} from '@sensewell/contracts';
import { ZoneEntryEvaluator } from './zone-entry.js';

type Sample = RecordingObservation & {
  recordingId: string;
  cameraId?: string;
  atMs: number;
  source?: Map<ObjectDetection, Sample>;
  alternateBoxes?: Map<ObjectDetection, ObjectDetection['box'][]>;
};
type Sighting = {
  atMs: number;
  clip: DwellCandidate['evidence'][number];
  box: ObjectDetection['box'];
  alternateBoxes?: ObjectDetection['box'][];
  floor?: ZonePoint;
  index: number;
};
type Visit = {
  cameraId?: string;
  first: Sighting;
  last: Sighting;
  sightings: Sighting[];
  entered: boolean;
  exitMs?: number;
};
const confidenceThreshold = 0.5;
const synchronizationToleranceMs = 120;
const floorAssociationDistanceM = 0.8;

function duplicateForkliftBox(a: ObjectDetection['box'], b: ObjectDetection['box']) {
  if (boxOverlap(a, b) < 0.7) return false;
  const xTolerance = Math.min(a[2] - a[0], b[2] - b[0]) * 0.04;
  const yTolerance = Math.min(a[3] - a[1], b[3] - b[1]) * 0.04;
  return Math.abs(a[1] - b[1]) <= yTolerance && Math.abs(a[3] - b[3]) <= yTolerance &&
    (Math.abs(a[0] - b[0]) <= xTolerance || Math.abs(a[2] - b[2]) <= xTolerance);
}

function trackingDetections(detections: ObjectDetection[]) {
  const credible = detections.filter(({ confidence }) => confidence >= confidenceThreshold);
  const forklifts = credible.filter(({ objectType }) => objectType === 'forklift')
    .sort((a, b) => b.confidence - a.confidence);
  const unique: ObjectDetection[] = [];
  for (const detection of forklifts) {
    // The detector can return a full box and a partial box sharing the same wheel line and side.
    if (!unique.some(({ box }) => duplicateForkliftBox(box, detection.box))) unique.push(detection);
  }
  return [...credible.filter(({ objectType }) => objectType !== 'forklift'), ...unique];
}

function timeline(recordings: DwellRecording[], { startMs, endMs }: TriggerRange) {
  const frames = new Map<number, Sample>();
  const unavailable: Sample[] = [];
  const coverage: TriggerRange[] = [];
  for (const { id, cameraId, startMs: segmentStart, endMs: segmentEnd, frames: observations } of recordings) {
    let previous: Sample | undefined;
    for (const frame of observations) {
      const atMs = segmentStart + frame.offsetMs;
      if (atMs < startMs || atMs > endMs || atMs >= segmentEnd) continue;
      const sample = {
        ...frame, atMs, recordingId: id, cameraId,
        detections: frame.detections && trackingDetections(frame.detections),
      };
      if (sample.detections) {
        const retained = frames.get(atMs);
        if (!retained) frames.set(atMs, sample);
        else {
          for (const detection of sample.detections) {
            const equivalent = retained.detections!.find(({ objectType, box }) =>
              objectType === detection.objectType && boxOverlap(box, detection.box) >= 0.3);
            if (equivalent) {
              const alternateBoxes = retained.alternateBoxes ??= new Map();
              alternateBoxes.set(equivalent, [...(alternateBoxes.get(equivalent) ?? []), detection.box]);
              continue;
            }
            retained.detections!.push(detection);
            (retained.source ??= new Map()).set(detection, sample);
          }
        }
        if (previous && atMs - previous.atMs <= confirmationGapMs) {
          coverage.push({ startMs: previous.atMs, endMs: atMs });
        }
        previous = sample;
      } else {
        unavailable.push(sample);
        previous = undefined;
      }
    }
  }

  coverage.sort((a, b) => a.startMs - b.startMs);
  let index = 0;
  let coveredThrough = -Infinity;
  for (const sample of unavailable.sort((a, b) => a.atMs - b.atMs)) {
    while (index < coverage.length && coverage[index]!.startMs <= sample.atMs) {
      coveredThrough = Math.max(coveredThrough, coverage[index++]!.endMs);
    }
    // Only a separate recording can supply coverage across an unavailable sample.
    if (!frames.has(sample.atMs) && coveredThrough < sample.atMs) frames.set(sample.atMs, sample);
  }
  return [...frames.values()].sort((a, b) => a.atMs - b.atMs);
}

function observeVisits(
  zone: CameraZone, recordings: DwellRecording[], range: TriggerRange, durationMs: number, cameraId?: string,
) {
  const gaps: TriggerRange[] = [];
  const visits: Visit[] = [];
  const tracker = new ZoneEntryEvaluator();
  const rule = {
    ...zone, zoneName: zone.name, revision: 1,
    eventType: 'both' as const, minimumConfidence: confidenceThreshold, objectTypes: ['forklift'], strictIdentity: true,
  };
  let open = new Map<number, Visit>();
  let coveredThrough: number | undefined;
  let gapSince = range.startMs;

  for (const sample of timeline(recordings, range)) {
    const { atMs, detections } = sample;
    if (!detections) {
      tracker.interrupt();
      open = new Map();
      coveredThrough = undefined;
      continue;
    }
    if (coveredThrough === undefined || atMs - coveredThrough > confirmationGapMs) {
      if (atMs > gapSince) gaps.push({ startMs: gapSince, endMs: atMs });
      open = new Map();
    }
    coveredThrough = atMs;
    gapSince = atMs;
    const { evidence } = tracker.evaluate(atMs, detections, [rule]);
    const frame = evidence.rules[0]!;
    const entries = new Set<number>();
    const exits = new Set<number>();
    for (const { trackId, direction, certainty } of frame.crossings) {
      if (certainty === 'confirmed') (direction === 'entry' ? entries : exits).add(trackId);
    }
    const next = new Map<number, Visit>();
    for (const [index, position] of (frame.inside ?? []).entries()) {
      const { detection, trackId, ground } = position;
      const { recordingId, offsetMs, cameraId: sourceCamera } = sample.source?.get(detection) ?? sample;
      const sighting = {
        atMs, index, box: detection.box, alternateBoxes: sample.alternateBoxes?.get(detection),
        floor: ground?.points[0]?.floor,
        clip: { recordingId, offsetMs, ...(sourceCamera ? { cameraId: sourceCamera } : {}) },
      };
      let visit = open.get(trackId);
      if (visit) {
        visit.last = sighting;
        visit.sightings.push(sighting);
      } else {
        visit = { cameraId, first: sighting, last: sighting, sightings: [sighting], entered: entries.has(trackId) };
        visits.push(visit);
      }
      next.set(trackId, visit);
    }
    for (const [trackId, visit] of open) {
      if (next.has(trackId)) continue;
      if (exits.has(trackId)) visit.exitMs = atMs;
      const threshold = visit.first.atMs + durationMs;
      if (visit.exitMs === undefined || (visit.last.atMs < threshold && atMs > threshold)) {
        gaps.push({ startMs: visit.last.atMs, endMs: atMs });
      }
    }
    if (frame.unknownTrackIds.length) gaps.push({ startMs: atMs, endMs: atMs });
    open = next;
  }

  if (coveredThrough === undefined || range.endMs - coveredThrough > confirmationGapMs) {
    gaps.push({ startMs: gapSince, endMs: range.endMs });
  }
  return { visits, gaps };
}

function timeOverlap(a: Visit, b: Visit) {
  return Math.min(a.last.atMs, b.last.atMs) - Math.max(a.first.atMs, b.first.atMs);
}

function cameraAgreement(a: Visit, b: Visit): 'consistent' | 'conflicting' | 'insufficient' {
  if (a.cameraId === b.cameraId || timeOverlap(a, b) < 0) return 'insufficient';
  if ((a.exitMs !== undefined && a.exitMs + synchronizationToleranceMs < b.last.atMs) ||
      (b.exitMs !== undefined && b.exitMs + synchronizationToleranceMs < a.last.atMs)) return 'conflicting';
  let nearest = 0;
  let firstAgreement: number | undefined;
  let lastAgreement: number | undefined;
  let previousMatch = -1;
  for (const sample of a.sightings) {
    while (nearest + 1 < b.sightings.length &&
           Math.abs(b.sightings[nearest + 1]!.atMs - sample.atMs) < Math.abs(b.sightings[nearest]!.atMs - sample.atMs)) nearest++;
    const other = b.sightings[nearest]!;
    if (Math.abs(other.atMs - sample.atMs) > synchronizationToleranceMs) continue;
    if (!sample.floor || !other.floor) continue;
    if (Math.hypot(sample.floor.x - other.floor.x, sample.floor.y - other.floor.y) > floorAssociationDistanceM) return 'conflicting';
    if (nearest === previousMatch) continue;
    firstAgreement ??= sample.atMs;
    lastAgreement = sample.atMs;
    previousMatch = nearest;
  }
  return firstAgreement !== undefined && lastAgreement! - firstAgreement >= confirmationGapMs ? 'consistent' : 'insufficient';
}

function linkVisits(byCamera: Visit[][]) {
  const candidates = new Map<Visit, Visit[]>();
  const visits = byCamera.flat();
  for (const [index, first] of byCamera.entries()) {
    for (const second of byCamera.slice(index + 1)) {
      for (const a of first) for (const b of second) {
        if (cameraAgreement(a, b) !== 'consistent') continue;
        candidates.set(a, [...(candidates.get(a) ?? []), b]);
        candidates.set(b, [...(candidates.get(b) ?? []), a]);
      }
    }
  }
  const unambiguous = (a: Visit, b: Visit) =>
    !candidates.get(a)?.some((other) => other !== b && other.cameraId === b.cameraId && timeOverlap(other, b) >= 0);
  const visited = new Set<Visit>();
  const groups: Visit[][] = [];
  for (const visit of visits) {
    if (visited.has(visit)) continue;
    const group = [visit];
    visited.add(visit);
    for (const current of group) {
      for (const next of candidates.get(current) ?? []) {
        if (visited.has(next) || !unambiguous(current, next) || !unambiguous(next, current)) continue;
        group.push(next);
        visited.add(next);
      }
    }
    // A transitive link cannot resolve conflicting evidence from the same camera.
    if (group.some((a, index) => group.slice(index + 1).some((b) =>
      (a.cameraId === b.cameraId && timeOverlap(a, b) >= 0) ||
      cameraAgreement(a, b) === 'conflicting'))) {
      groups.push(...group.map((item) => [item]));
    } else {
      groups.push(group);
    }
  }
  return groups;
}

export function evaluateForkliftDwell(
  condition: ForkliftDwellCondition, recordings: DwellRecording[], range: TriggerRange,
  activationMs?: number, cameraId?: string, published: PublishedDwell[] = [],
): Omit<TriggerPreview, 'matches'> & { matches: DwellCandidate[] } {
  const window = { startMs: Math.max(range.startMs, activationMs ?? range.startMs), endMs: range.endMs };
  if (window.endMs < window.startMs) return { matches: [], undecided: [] };
  const views = [{ cameraId, zone: condition.zone }, ...(condition.supportingViews ?? [])].map((view) =>
    observeVisits(view.zone, recordings.filter((recording) => recording.cameraId === view.cameraId),
      window, condition.durationMs, view.cameraId));
  const [primary] = views;
  const matches: DwellCandidate[] = [];
  const trackedGaps: TriggerRange[] = [];
  const corroborated: TriggerRange[] = [];
  for (const visits of linkVisits(views.map(({ visits }) => visits))) {
    const entries = visits.filter(({ entered }) => entered).map(({ first }) => first).sort((a, b) => a.atMs - b.atMs);
    const entry = entries[0];
    if (!entry || visits.some(({ first }) => first.atMs < entry.atMs)) {
      for (const visit of visits) trackedGaps.push({ startMs: visit.first.atMs, endMs: visit.last.atMs });
      continue;
    }
    if (visits.length > 1) {
      corroborated.push({ startMs: entry.atMs, endMs: Math.max(...visits.map(({ last }) => last.atMs)) });
    }
    const occurrenceMs = entry.atMs + condition.durationMs;
    let established: Sighting | undefined;
    for (const visit of visits) {
      const sample = visit.sightings.find(({ atMs }) => atMs >= occurrenceMs);
      if (sample && (!established || sample.atMs < established.atMs)) established = sample;
    }
    if (!established) continue;
    const known = published.some((match) => visits.some(({ sightings }) => {
      const sample = sightings.find(({ atMs, clip }) => atMs === match.establishedMs && clip.cameraId === match.evidence[1].cameraId);
      // Reuse a qualification observation to identify an already recorded dwell, even if late footage moves its entry.
      return sample && [sample.box, ...(sample.alternateBoxes ?? [])]
        .some((box) => boxOverlap(box, match.qualificationBox) >= 0.6);
    }));
    if (known) continue;
    const supportingEvidence = visits
      .filter(({ first, last }) => first.atMs <= established.atMs && last.atMs >= entry.atMs)
      .filter(({ cameraId }) => cameraId !== entry.clip.cameraId && cameraId !== established.clip.cameraId)
      .map(({ sightings }) => sightings.find(({ atMs }) => atMs >= entry.atMs)!.clip);
    matches.push({
      entryMs: entry.atMs, occurrenceMs, establishedMs: established.atMs,
      occurrenceKey: `${entry.clip.recordingId}:${entry.clip.offsetMs}:${entry.index}`,
      qualificationBox: established.box,
      evidence: [entry.clip, established.clip],
      ...(supportingEvidence.length ? { supportingEvidence } : {}),
    });
  }

  const gaps = [
    ...primary!.gaps.filter((gap) => !corroborated.some((proof) => proof.startMs <= gap.startMs && proof.endMs >= gap.endMs)),
    ...trackedGaps,
  ].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const undecided: TriggerRange[] = [];
  for (const gap of gaps) {
    const previous = undecided.at(-1);
    if (previous && gap.startMs - previous.endMs <= confirmationGapMs) previous.endMs = Math.max(previous.endMs, gap.endMs);
    else undecided.push({ ...gap });
  }
  return { matches: matches.sort((a, b) => a.occurrenceMs - b.occurrenceMs), undecided };
}
