import type { PersonDetection, ZoneCrossingDirection, ZonePoint, ZoneRuleEventType } from '@sensewell/contracts';

interface EntryRule {
  id: string;
  revision: number;
  minimumConfidence: number;
  eventType: ZoneRuleEventType;
  points: ZonePoint[];
}

interface Track {
  person: PersonDetection;
  sourceMs: number;
  zones: Map<string, { inside: boolean; version: string }>;
}

const recoveryMs = 500;
const confirmationGapMs = 400;
const minimumTrackOverlap = 0.3;

function boxOverlap(a: PersonDetection['box'], b: PersonDetection['box']) {
  const width = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const height = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const intersection = width * height;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - intersection;
  return intersection / union;
}

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

function overlapsZone([left, top, right, bottom]: PersonDetection['box'], points: ZonePoint[]) {
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

  reset() {
    this.tracks = [];
    this.lastAnalyzedMs = undefined;
  }

  observe<Rule extends EntryRule>(sourceMs: number, people: PersonDetection[], rules: Rule[]) {
    const tracks = this.tracks.filter((track) => sourceMs - track.sourceMs <= recoveryMs);
    const candidates = people.map(({ box }) =>
      tracks.filter((track) => boxOverlap(track.person.box, box) >= minimumTrackOverlap));
    const candidateCounts = new Map<Track, number>();
    for (const matches of candidates) {
      for (const track of matches) candidateCounts.set(track, (candidateCounts.get(track) ?? 0) + 1);
    }

    const crossings: { rule: Rule; person: PersonDetection; direction: ZoneCrossingDirection }[] = [];
    const versions = rules.map((rule) => ({ rule, version: JSON.stringify([rule.revision, rule.points]) }));
    // Keep unmatched tracks briefly. Discard ambiguous associations instead of guessing.
    this.tracks = tracks.filter((track) => !candidateCounts.has(track));
    for (const [index, person] of people.entries()) {
      const matches = candidates[index]!;
      const match = matches.length === 1 ? matches[0] : undefined;
      const previous = match && candidateCounts.get(match) === 1 ? match : undefined;
      const continuous = previous && previous.sourceMs === this.lastAnalyzedMs
        && sourceMs - previous.sourceMs <= confirmationGapMs;
      const zones: Track['zones'] = new Map();
      for (const { rule, version } of versions) {
        if (person.confidence < rule.minimumConfidence) continue;
        const inside = overlapsZone(person.box, rule.points);
        zones.set(rule.id, { inside, version });
        const before = previous?.zones.get(rule.id);
        if (continuous && before?.version === version && before.inside !== inside) {
          const direction = inside ? 'entry' : 'exit';
          if (rule.eventType === 'both' || rule.eventType === direction) crossings.push({ rule, person, direction });
        }
      }
      this.tracks.push({ person, sourceMs, zones });
    }
    this.lastAnalyzedMs = sourceMs;
    return crossings;
  }
}
