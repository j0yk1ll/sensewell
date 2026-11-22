import { z } from 'zod';
import { groundDecision } from './ground-zone.js';
import { cameraZone } from './camera-zone.js';
import { zoneCrossingDirection } from './zone-entry.js';
import { objectDetection, warehouseObjectType } from './replay-analysis.js';

const timestamp = z.number().int().nonnegative();
const sample = z.object({ sourceMs: timestamp, detection: objectDetection, points: cameraZone.shape.points, ground: groundDecision.optional() });
const trackedSample = sample.extend({ trackId: z.number().int().positive() });
const crossing = z.object({
  trackId: trackedSample.shape.trackId,
  certainty: z.enum(['confirmed', 'possible']),
  direction: zoneCrossingDirection,
  before: sample,
  after: sample,
});
const gap = z.object({
  trackId: trackedSample.shape.trackId,
  startMs: timestamp,
  endMs: timestamp.nullable(),
  observation: sample.optional(),
  reason: z.enum(['missing', 'recovered', 'ambiguous', 'expired', 'ground-unknown']),
});
const visit = z.object({
  trackId: trackedSample.shape.trackId,
  firstInside: sample,
  lastInside: sample,
  entry: sample.nullable(),
  exit: sample.nullable(),
  state: z.enum(['open', 'complete', 'partial']),
  reason: z.enum(['possible-exit', 'ground-unknown', 'ambiguous', 'expired', 'rule-changed', 'pass-ended']).nullable(),
});
const subject = z.object({
  ruleId: z.string(),
  ruleName: z.string(),
  zoneName: z.string(),
  objectType: warehouseObjectType,
});

const ruleFrame = subject.extend({
  inside: z.array(trackedSample).nullable(),
  positions: z.array(trackedSample).optional(),
  unknownTrackIds: z.array(trackedSample.shape.trackId),
  crossings: z.array(crossing),
  gaps: z.array(gap),
  visits: z.array(visit),
});

export const zoneActivityFrame = z.object({ rules: z.array(ruleFrame) });

export const zoneActivityPasses = z.array(z.object({
  id: z.uuid(),
  passNumber: z.number().int().positive(),
  startedAt: z.iso.datetime(),
}));

export const zoneActivity = z.object({
  passId: z.uuid(),
  coverage: z.object({ firstMs: timestamp, lastMs: timestamp }).nullable(),
  active: z.boolean(),
  rules: z.array(subject.extend({
    entries: z.number().int().nonnegative(),
    distinctEntrants: z.number().int().nonnegative(),
    occupancy: z.object({
      sourceMs: timestamp, inside: z.array(trackedSample), positions: z.array(trackedSample).optional(), unknownTrackIds: z.array(trackedSample.shape.trackId),
    }).nullable(),
    crossings: z.array(crossing),
    gaps: z.array(gap),
    visits: z.array(visit),
  })),
});

export type ZoneActivityFrame = z.infer<typeof zoneActivityFrame>;
export type ZoneActivity = z.infer<typeof zoneActivity>;

export function zoneActivityRuleKey({ ruleId, objectType }: Pick<ZoneActivityFrame['rules'][number], 'ruleId' | 'objectType'>) {
  return `${ruleId}:${objectType}`;
}
