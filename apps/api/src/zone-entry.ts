import { boxOverlap, calibrateGroundZone, confirmationGapMs, warehouseObjectType, zoneActivityRuleKey, type GroundDecision, type GroundZone, type ObjectDetection, type WarehouseObjectType, type ZoneActivityFrame, type ZoneCrossingDirection, type ZonePoint, type ZoneRuleEventType } from '@sensewell/contracts';

import { groundPosition } from './ground-position.js';

interface EntryRule {
  id: string;
  revision: number;
  name: string;
  zoneName: string;
  minimumConfidence: number;
  eventType: ZoneRuleEventType;
  objectTypes: string[];
  points: ZonePoint[];
  ground?: GroundZone | null;
  strictIdentity?: boolean;
}

type RuleFrame = ZoneActivityFrame['rules'][number];
type Visit = RuleFrame['visits'][number];
type Sample = Visit['lastInside'];
type Subject = Pick<RuleFrame, 'ruleId' | 'ruleName' | 'zoneName' | 'objectType'>;

interface ZoneState {
  subject: Subject;
  version: string;
  inside: boolean | null;
  sample: Sample;
  missing?: boolean;
  uncertainty?: Sample;
  boundaryThroughMs?: number;
  visit?: Visit;
}

interface Track {
  id: number;
  detection: ObjectDetection;
  sourceMs: number;
  zones: Map<string, ZoneState>;
}

const recoveryMs = 500;
const boundaryCrossingMs = 1500;
export { confirmationGapMs };
const minimumTrackOverlap = 0.3;
const competingTrackOverlap = 0.15;


function clipAtBound(points: ZonePoint[], axis: keyof ZonePoint, bound: number, sign: number) {
  const clipped: ZonePoint[] = [];
  for (const [index, end] of points.entries()) {
    const start = points[(index + points.length - 1) % points.length]!;
    const from = sign * (start[axis] - bound);
    const to = sign * (end[axis] - bound);
    if ((from >= 0) !== (to >= 0)) {
      const fraction = from / (from - to);
      clipped.push({
        x: start.x + fraction * (end.x - start.x),
        y: start.y + fraction * (end.y - start.y),
        [axis]: bound,
      });
    }
    if (to >= 0) clipped.push(end);
  }
  return clipped;
}

function overlapsZone([left, top, right, bottom]: ObjectDetection['box'], points: ZonePoint[]) {
  // Clip the zone polygon against all four sides of the detection box.
  let overlap = clipAtBound(points, 'x', left, 1);
  overlap = clipAtBound(overlap, 'x', right, -1);
  overlap = clipAtBound(overlap, 'y', top, 1);
  overlap = clipAtBound(overlap, 'y', bottom, -1);
  const origin = overlap[0];
  if (!origin) return false;

  // A shared edge or corner has zero area.
  const twiceArea = overlap.reduce((area, point, index) => {
    const next = overlap[(index + 1) % overlap.length]!;
    return area + (point.x - origin.x) * (next.y - origin.y) - (next.x - origin.x) * (point.y - origin.y);
  }, 0);
  return Math.abs(twiceArea) > Number.EPSILON;
}

export class ZoneEntryEvaluator {
  private tracks: Track[] = [];
  private lastAnalyzedMs: number | undefined;
  private nextTrackId = 1;

  interrupt() {
    this.lastAnalyzedMs = undefined;
  }

  checkpoint() {
    const { tracks, lastAnalyzedMs, nextTrackId } = this;
    return () => {
      this.tracks = tracks;
      this.lastAnalyzedMs = lastAnalyzedMs;
      this.nextTrackId = nextTrackId;
    };
  }

  observe<Rule extends EntryRule>(sourceMs: number, detections: ObjectDetection[], rules: Rule[]) {
    return this.evaluate(sourceMs, detections, rules).crossings;
  }

  evaluate<Rule extends EntryRule>(sourceMs: number, detections: ObjectDetection[], rules: Rule[]) {
    const tracks = this.tracks.filter((track) => sourceMs - track.sourceMs <= recoveryMs);
    const strictTypes = new Set(rules.filter(({ ground, strictIdentity }) => ground || strictIdentity).flatMap(({ objectTypes }) => objectTypes));
    const candidates = detections.map(({ box, objectType }) => {
      const overlaps = tracks.filter((track) => track.detection.objectType === objectType)
        .map((track) => ({ track, overlap: boxOverlap(track.detection.box, box) }));
      const strong = overlaps.filter(({ overlap }) => overlap >= minimumTrackOverlap);
      if (strictTypes.has(objectType) && strong.length === 1) {
        // A lower-overlap track can veto a match, but cannot establish one.
        const plausible = overlaps.filter(({ overlap }) => overlap >= competingTrackOverlap);
        if (plausible.length > 1) return plausible.map(({ track }) => track);
      }
      return strong.map(({ track }) => track);
    });
    const candidateCounts = new Map<Track, number>();
    const uniqueMatches = new Set<Track>();
    for (const matches of candidates) {
      for (const track of matches) candidateCounts.set(track, (candidateCounts.get(track) ?? 0) + 1);
      if (matches.length === 1) uniqueMatches.add(matches[0]!);
    }

    const crossings: { rule: Rule; detection: ObjectDetection; direction: ZoneCrossingDirection; ground?: GroundDecision }[] = [];
    const frames = new Map<string, RuleFrame>();
    function frameFor(subject: Subject) {
      const key = zoneActivityRuleKey(subject);
      let frame = frames.get(key);
      if (!frame) {
        frame = { ...subject, inside: null, unknownTrackIds: [], crossings: [], gaps: [], visits: [] };
        frames.set(key, frame);
      }
      return frame;
    }
    const subjectFor = (rule: Rule, objectType: WarehouseObjectType): Subject => ({
      ruleId: rule.id, ruleName: rule.name, zoneName: rule.zoneName, objectType,
    });
    const versions = new Map(rules.map((rule) => [rule.id, JSON.stringify([rule.revision, rule.points, rule.ground])]));
    const calibrations = new Map(rules.flatMap(({ id, ground }) => ground ? [[id, calibrateGroundZone(ground)] as const] : []));
    for (const rule of rules) {
      for (const objectType of rule.objectTypes) {
        const parsed = warehouseObjectType.safeParse(objectType);
        if (parsed.success) {
          const frame = frameFor(subjectFor(rule, parsed.data));
          frame.inside = [];
          if (rule.ground) frame.positions = [];
        }
      }
    }

    const retained = new Map<Track, Track>();
    const nextTracks: Track[] = [];
    const trackIds: number[] = [];
    for (const track of this.tracks) {
      const count = candidateCounts.get(track) ?? 0;
      const loss = sourceMs - track.sourceMs > recoveryMs ? 'expired'
        : count > 1 || (count === 1 && !uniqueMatches.has(track)) ? 'ambiguous' : undefined;
      const zones: Track['zones'] = new Map();
      for (const [ruleId, before] of track.zones) {
        if (!loss && versions.get(ruleId) === before.version) {
          zones.set(ruleId, before);
          continue;
        }
        const frame = frameFor(before.subject);
        if (loss) frame.gaps.push({ trackId: track.id, startMs: before.sample.sourceMs, endMs: null, reason: loss, ...(before.uncertainty ? { observation: before.uncertainty } : {}) });
        if (before.visit) frame.visits.push({ ...before.visit, state: 'partial', reason: loss ?? 'rule-changed' });
      }
      if (loss) continue;
      const available = { ...track, zones };
      retained.set(track, available);
      if (!count) nextTracks.push(available);
    }

    for (const [index, detection] of detections.entries()) {
      const matches = candidates[index]!;
      const previous = matches.length === 1 ? retained.get(matches[0]!) : undefined;
      const trackId = previous?.id ?? this.nextTrackId++;
      trackIds.push(trackId);
      const zones = previous?.zones ?? new Map<string, ZoneState>();
      for (const rule of rules) {
        if (detection.confidence < rule.minimumConfidence || !rule.objectTypes.includes(detection.objectType)) continue;
        const ground = rule.ground && groundPosition(detection, detections, rule.ground, calibrations.get(rule.id));
        const sample = { sourceMs, detection, points: rule.points, ...(ground ? { ground } : {}) };
        const subject = subjectFor(rule, detection.objectType);
        const frame = frameFor(subject);
        frame.positions?.push({ ...sample, trackId });
        const before = zones.get(rule.id);
        const version = versions.get(rule.id)!;
        const follows = (ms: number | undefined) => ms !== undefined && ms === this.lastAnalyzedMs
          && sourceMs - ms <= confirmationGapMs;
        const continuous = before && !before.missing && before.inside !== null && follows(before.sample.sourceMs);
        const followsBoundary = before && follows(before.boundaryThroughMs)
          && sourceMs - before.sample.sourceMs <= boundaryCrossingMs;
        if (ground && ground.state === 'unknown') {
          frame.unknownTrackIds.push(trackId);
          if (!before?.uncertainty) {
            frame.gaps.push({ trackId, startMs: before?.sample.sourceMs ?? sourceMs, endMs: null, reason: 'ground-unknown', observation: sample });
          }
          const nearBoundary = ground.reason === 'near-boundary' && (continuous || followsBoundary);
          if (before?.visit && !before.uncertainty) {
            frame.visits.push({ ...before.visit, state: 'partial', reason: 'ground-unknown' });
          }
          zones.set(rule.id, {
            subject, version, inside: before?.inside ?? null, sample: before?.sample ?? sample, missing: true,
            uncertainty: before?.uncertainty ?? sample,
            boundaryThroughMs: nearBoundary ? sourceMs : undefined,
          });
          continue;
        }
        const inside = ground ? ground.state === 'inside' : overlapsZone(detection.box, rule.points);
        if (before && !continuous) {
          frame.gaps.push({
            trackId, startMs: before.sample.sourceMs, endMs: sourceMs, reason: before.uncertainty ? 'ground-unknown' : 'recovered',
            ...(before.uncertainty ? { observation: before.uncertainty } : {}),
          });
        }
        const confirmed = continuous || followsBoundary;
        if (before && before.inside !== null && before.inside !== inside) {
          const direction = inside ? 'entry' : 'exit';
          frame.crossings.push({
            trackId, certainty: confirmed ? 'confirmed' : 'possible',
            direction, before: before.sample, after: sample,
          });
          if (confirmed && (rule.eventType === 'both' || rule.eventType === direction)) {
            crossings.push({ rule, detection, direction, ...(ground ? { ground } : {}) });
          }
        }

        let visit: Visit | undefined;
        if (inside) {
          frame.inside?.push({ ...sample, trackId });
          if (ground && before?.visit && !continuous) {
            frame.visits.push({ ...before.visit, state: 'partial', reason: 'ground-unknown' });
          }
          visit = before?.visit && (!ground || continuous) ? { ...before.visit, lastInside: sample } : {
            trackId, firstInside: sample, lastInside: sample, entry: before?.inside === false && confirmed ? sample : null,
            exit: null, state: 'open', reason: null,
          };
          frame.visits.push(visit);
        } else if (before?.visit) {
          const exit = confirmed ? sample : null;
          frame.visits.push({
            ...before.visit, exit, state: before.visit.entry && exit ? 'complete' : 'partial',
            reason: exit ? null : 'possible-exit',
          });
        }
        zones.set(rule.id, { subject, version, inside, sample, visit });
      }
      nextTracks.push({ id: trackId, detection, sourceMs, zones });
    }
    for (const track of nextTracks) {
      for (const [ruleId, state] of track.zones) {
        if (state.sample.sourceMs === sourceMs || frameFor(state.subject).unknownTrackIds.includes(track.id)) continue;
        const frame = frameFor(state.subject);
        frame.unknownTrackIds.push(track.id);
        if (!state.missing) {
          frame.gaps.push({ trackId: track.id, startMs: state.sample.sourceMs, endMs: null, reason: 'missing' });
          if (state.sample.ground && state.visit) {
            frame.visits.push({ ...state.visit, state: 'partial', reason: 'ground-unknown' });
          }
          track.zones.set(ruleId, { ...state, missing: true, boundaryThroughMs: undefined, visit: state.sample.ground ? undefined : state.visit });
        }
      }
    }
    this.tracks = nextTracks;
    this.lastAnalyzedMs = sourceMs;
    return { crossings, trackIds, evidence: { rules: [...frames.values()] } };
  }
}
