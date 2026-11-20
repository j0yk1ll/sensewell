import { z } from 'zod';
import { cameraZone, cameraZoneInput } from './camera-zone.js';
import { personDetection } from './replay-analysis.js';

export const zoneEntryRuleInput = z.strictObject({
  zoneId: z.uuid(),
  name: cameraZoneInput.shape.name,
  minimumConfidence: personDetection.shape.confidence,
});
export type ZoneEntryRuleInput = z.infer<typeof zoneEntryRuleInput>;

export const zoneEntryRuleToggle = z.strictObject({ enabled: z.boolean() });
export const zoneEntryRule = zoneEntryRuleInput.extend({
  id: z.uuid(),
  enabled: z.boolean(),
});
export const zoneEntryRuleList = z.array(zoneEntryRule);

const zoneEntryEvent = z.object({
  id: z.uuid(),
  cameraName: z.string(),
  zoneName: z.string(),
  ruleName: z.string(),
  occurredAt: z.iso.datetime(),
  passId: z.uuid(),
  passNumber: z.number().int().positive(),
  sourceMs: z.number().int().nonnegative(),
});
export const zoneEntryHistory = z.array(zoneEntryEvent);
export type ZoneEntryEvent = z.infer<typeof zoneEntryEvent>;

export const zoneEntryEvidence = zoneEntryEvent.extend({
  zone: cameraZone,
  person: personDetection,
  jpeg: z.string().max(1_398_104),
});
