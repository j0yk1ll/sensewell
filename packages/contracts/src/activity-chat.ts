import { z } from 'zod';
import { warehouseObjectType } from './replay-analysis.js';

const sourceMs = z.number().int().nonnegative();
export const maxActivityQuestionLength = 2000;
const question = z.string().trim().min(1).max(maxActivityQuestionLength);

export const activityChatInput = z.object({
  question,
  previousQuestions: z.array(question).max(3).optional(),
  passId: z.uuid().optional(),
});

export const activityQuery = z.object({
  camera: z.string().trim().min(1).max(100).optional().describe('Camera ID or exact name. Defaults to the selected camera.'),
  passId: z.uuid().optional().describe('Replay pass ID, when known.'),
  passNumber: z.number().int().positive().optional().describe('Pass number if explicitly requested. Uses the most recent match.'),
  zone: z.string().trim().min(1).max(100).optional().describe('Exact zone name if requested.'),
  fromMs: sourceMs.optional().describe('Inclusive start in milliseconds from the start of the clip.'),
  toMs: sourceMs.optional().describe('Inclusive end in milliseconds from the start of the clip.'),
  atMs: sourceMs.optional().describe('Source time in milliseconds for an occupancy question.'),
  minimumConfidence: z.number().min(0).max(1).optional().describe('Minimum detection confidence as a fraction. 20% is 0.2. Defaults to 0.5.'),
  includePossible: z.boolean().optional().describe('Include possible crossings if the operator asks for them. Defaults to false.'),
  objectType: warehouseObjectType.optional().describe('Object class. Defaults to person.'),
});

export const activityChatSource = z.object({
  cameraId: z.uuid(),
  cameraName: z.string(),
  passId: z.uuid(),
  passNumber: z.number().int().positive(),
  passStartedAt: z.iso.datetime(),
  fromMs: sourceMs,
  toMs: sourceMs,
  coverage: z.object({ firstMs: sourceMs, lastMs: sourceMs }).nullable(),
  incomplete: z.boolean(),
  active: z.boolean(),
  timestamps: z.array(sourceMs),
});

export const activityChatResponse = z.object({
  answer: z.string().min(1),
  sources: z.array(activityChatSource),
});

export type ActivityChatInput = z.infer<typeof activityChatInput>;
export type ActivityChatSource = z.infer<typeof activityChatSource>;
export type ActivityQuery = z.infer<typeof activityQuery>;
