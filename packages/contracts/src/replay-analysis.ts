import { z } from 'zod';

const coordinate = z.number().min(0).max(1);

export const personDetection = z.object({
  box: z.tuple([coordinate, coordinate, coordinate, coordinate])
    .refine(([left, top, right, bottom]) => right > left && bottom > top),
  confidence: coordinate,
});

export const personDetections = z.array(personDetection).max(300);

export const replayFrameAnalysis = z.discriminatedUnion('state', [
  z.object({ state: z.literal('analyzed'), people: personDetections }),
  z.object({ state: z.enum(['delayed', 'skipped', 'unavailable']) }),
]);
export type ReplayFrameAnalysis = z.infer<typeof replayFrameAnalysis>;

export const replayImage = z.object({
  passId: z.uuid(),
  passNumber: z.number().int().positive(),
  sourceMs: z.number().int().nonnegative(),
  jpeg: z.string().max(1_398_104),
  analysis: replayFrameAnalysis,
  analyzedFrames: z.number().int().nonnegative(),
  totalFrames: z.number().int().positive(),
});
export type ReplayImage = z.infer<typeof replayImage>;
