import { z } from 'zod';
import { cameraZone } from './camera-zone.js';
import type { ObjectDetection } from './replay-analysis.js';

export const forkliftDwellMs = 300_000;
export const confirmationGapMs = 400;
// Includes the preceding observations that can confirm a crossing near the zone boundary.
export const forkliftDwellLookbackMs = forkliftDwellMs + 2000;
export const forkliftDwellCondition = z.strictObject({
  operator: z.literal('continuous-presence'),
  subject: z.literal('same-forklift'),
  durationMs: z.literal(forkliftDwellMs),
  zone: cameraZone,
  supportingViews: z.array(z.object({ cameraId: z.uuid(), zone: cameraZone })).optional(),
});
export type ForkliftDwellCondition = z.infer<typeof forkliftDwellCondition>;

export const triggerDraftInput = z.strictObject({ zoneId: z.uuid(), request: z.string().trim().min(1).max(1000) });
export const triggerToggle = z.strictObject({ enabled: z.boolean() });
export const triggerPreviewRange = z.strictObject({
  startMs: z.int().nonnegative().max(8.64e15),
  endMs: z.int().nonnegative().max(8.64e15),
}).refine(({ startMs, endMs }) => endMs > startMs && endMs - startMs <= 3_600_000);
export type TriggerRange = z.infer<typeof triggerPreviewRange>;

export const evidenceClip = z.object({ recordingId: z.uuid(), cameraId: z.uuid().optional(), offsetMs: z.int().nonnegative() });
export const dwellMatch = z.object({
  entryMs: z.int(),
  occurrenceMs: z.int(),
  establishedMs: z.int(),
  evidence: z.tuple([evidenceClip, evidenceClip]),
  supportingEvidence: z.array(evidenceClip).optional(),
});
export type DwellMatch = z.infer<typeof dwellMatch>;
export type PublishedDwell = DwellMatch & { qualificationBox: ObjectDetection['box'] };
export type DwellCandidate = PublishedDwell & { occurrenceKey: string };


export const triggerPreview = z.object({
  matches: z.array(dwellMatch),
  undecided: z.array(z.object({ startMs: z.int(), endMs: z.int() })),
});
export type TriggerPreview = z.infer<typeof triggerPreview>;

export const dwellTrigger = z.object({
  id: z.uuid(),
  condition: forkliftDwellCondition,
  reviewed: z.boolean(),
  activeSince: z.iso.datetime().nullable(),
});
export const triggerDraft = z.object({
  trigger: dwellTrigger.nullable(),
  explanation: z.string(),
});
export const triggerWorkspace = z.object({
  triggers: z.array(dwellTrigger),
  analysisConfigured: z.boolean(),
  history: z.array(dwellMatch.extend({ id: z.uuid(), condition: forkliftDwellCondition })),
});

export interface RecordingObservation {
  offsetMs: number;
  detections: ObjectDetection[] | null;
}

export interface DwellRecording {
  id: string;
  cameraId?: string;
  startMs: number;
  endMs: number;
  frames: RecordingObservation[];
}
