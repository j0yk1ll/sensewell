import type { PersonDetection, ZonePoint } from '@sensewell/contracts';

interface EntryRule {
  id: string;
  revision: number;
  minimumConfidence: number;
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

function insideZone([left, top, right, bottom]: PersonDetection['box'], points: ZonePoint[]) {
  // Intersect the polygon with a line just above the bottom of the detection box.
  const y = bottom - (bottom - top) * 0.02;
  const crossings: number[] = [];
  for (const [index, a] of points.entries()) {
    const b = points[(index + 1) % points.length]!;
    if ((a.y > y) !== (b.y > y)) {
      crossings.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
    }
  }
  crossings.sort((a, b) => a - b);
  let covered = 0;
  for (let index = 0; index + 1 < crossings.length; index += 2) {
    covered += Math.max(0, Math.min(right, crossings[index + 1]!) - Math.max(left, crossings[index]!));
  }
  return covered >= (right - left) / 2;
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

    const entries: { rule: Rule; person: PersonDetection }[] = [];
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
        const inside = insideZone(person.box, rule.points);
        zones.set(rule.id, { inside, version });
        const before = previous?.zones.get(rule.id);
        if (continuous && before?.version === version && !before.inside && inside) {
          entries.push({ rule, person });
        }
      }
      this.tracks.push({ person, sourceMs, zones });
    }
    this.lastAnalyzedMs = sourceMs;
    return entries;
  }
}
