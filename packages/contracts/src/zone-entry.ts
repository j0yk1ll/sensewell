import { z } from 'zod';
import { cameraZone, cameraZoneInput } from './camera-zone.js';
import { objectDetection, warehouseObjectType } from './replay-analysis.js';

export const zoneRuleEventType = z.enum(['entry', 'exit', 'both']);
export type ZoneRuleEventType = z.infer<typeof zoneRuleEventType>;

const ruleObjectTypes = z.array(warehouseObjectType).min(1).max(warehouseObjectType.options.length)
  .refine((types) => new Set(types).size === types.length);

export const zoneEntryRuleInput = z.strictObject({
  zoneId: z.uuid(),
  eventType: zoneRuleEventType.optional(),
  objectTypes: ruleObjectTypes.optional(),
  name: cameraZoneInput.shape.name,
  minimumConfidence: objectDetection.shape.confidence,
});
export type ZoneEntryRuleInput = z.infer<typeof zoneEntryRuleInput>;

export const zoneEntryRuleToggle = z.strictObject({ enabled: z.boolean() });
export const zoneEntryRule = zoneEntryRuleInput.extend({
  eventType: zoneRuleEventType,
  objectTypes: ruleObjectTypes,
  id: z.uuid(),
  enabled: z.boolean(),
});
export type ZoneEntryRule = z.infer<typeof zoneEntryRule>;
export const zoneEntryRuleList = z.array(zoneEntryRule);

export const zoneCrossingDirection = z.enum(['entry', 'exit']);
export type ZoneCrossingDirection = z.infer<typeof zoneCrossingDirection>;

const zoneEntryEvent = z.object({
  direction: zoneCrossingDirection.default('entry'),
  objectType: warehouseObjectType,
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
  window: z.object({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }),
  detection: objectDetection,
  jpeg: z.string().max(1_398_104),
});
