import { zoneActivityRuleKey, type ZoneActivity, type ZoneActivityFrame } from '@sensewell/contracts';
import { confirmationGapMs } from './zone-entry.js';

type EvidenceFrame = { sourceMs: number; evidence: ZoneActivityFrame | null };
type RuleActivity = ZoneActivity['rules'][number];
type Visit = RuleActivity['visits'][number];
type RuleTotals = {
  result: RuleActivity;
  entrants: Set<number>;
  visits: Map<string, Visit>;
  gaps: Map<string, RuleActivity['gaps'][number]>;
};

export function summarizeZoneActivity(passId: string, frames: EvidenceFrame[], active: boolean, atMs?: number): ZoneActivity {
  const first = frames[0];
  const last = frames.at(-1);
  const coverage = first && last ? { firstMs: first.sourceMs, lastMs: last.sourceMs } : null;
  const target = atMs ?? last?.sourceMs;
  const occupancyFrame = target !== undefined && last && target <= last.sourceMs
    ? frames.findLast(({ sourceMs }) => sourceMs <= target && target - sourceMs <= confirmationGapMs)
    : undefined;
  const rules = new Map<string, RuleTotals>();

  for (const frame of frames) {
    for (const { inside, unknownTrackIds, crossings, gaps, visits, ...subject } of frame.evidence?.rules ?? []) {
      const key = zoneActivityRuleKey(subject);
      let totals = rules.get(key);
      if (!totals) {
        totals = {
          result: {
            ...subject, entries: 0, distinctEntrants: 0, occupancy: null, crossings: [], gaps: [], visits: [],
          },
          entrants: new Set(),
          visits: new Map(),
          gaps: new Map(),
        };
        rules.set(key, totals);
      }
      const { result } = totals;
      result.ruleName = subject.ruleName;
      result.zoneName = subject.zoneName;
      if (frame === occupancyFrame && inside) result.occupancy = { sourceMs: frame.sourceMs, inside, unknownTrackIds };
      for (const crossing of crossings) {
        if (crossing.certainty === 'confirmed' && crossing.direction === 'entry') {
          result.entries += 1;
          totals.entrants.add(crossing.trackId);
        }
        result.crossings.push(crossing);
      }
      for (const gap of gaps) totals.gaps.set(`${gap.trackId}:${gap.startMs}`, gap);
      for (const visit of visits) totals.visits.set(`${visit.trackId}:${visit.firstInside.sourceMs}`, visit);
    }
  }

  return {
    passId, active, coverage,
    rules: [...rules.values()].map(({ result, entrants, visits, gaps }) => {
      result.distinctEntrants = entrants.size;
      result.visits = [...visits.values()].map((visit): Visit => !active && visit.state === 'open'
        ? { ...visit, state: 'partial', reason: 'pass-ended' }
        : visit).sort((a, b) => b.firstInside.sourceMs - a.firstInside.sourceMs);
      result.crossings.reverse();
      result.gaps = [...gaps.values()].reverse();
      return result;
    }),
  };
}
