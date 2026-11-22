import { z } from 'zod';
import { imagePoint } from './ground-zone.js';

const coordinate = z.number().min(0).max(1);

const detectionGeometry = z.object({
  box: z.tuple([coordinate, coordinate, coordinate, coordinate])
    .refine(([left, top, right, bottom]) => right > left && bottom > top),
  confidence: coordinate,
});

export const warehouseObjectLabels = {
  person: 'Person',
  forklift: 'Forklift',
  pallet: 'Pallet',
  pallet_jack: 'Pallet jack',
  amr: 'AMR',
  robot: 'Robot',
  cart: 'Cart',
  box: 'Box',
  fitting_box: 'Fitting box',
  full_box: 'Full box',
  small_load_carrier: 'Small load carrier',
  stillage: 'Stillage',
  white_roll: 'White roll',
  ladder: 'Ladder',
  toolbox: 'Toolbox',
  bottle: 'Bottle',
  extinguisher: 'Extinguisher',
} as const;

export type WarehouseObjectType = keyof typeof warehouseObjectLabels;
export const warehouseObjectType = z.enum(Object.keys(warehouseObjectLabels) as WarehouseObjectType[]);
export const objectDetection = detectionGeometry.extend({
  objectType: warehouseObjectType,
  ankles: z.tuple([imagePoint.nullable(), imagePoint.nullable()]).optional(),
});
export type ObjectDetection = z.infer<typeof objectDetection>;

export const replayFrameAnalysis = z.discriminatedUnion('state', [
  z.object({ state: z.literal('analyzed'), detections: z.array(objectDetection).max(300) }),
  z.object({ state: z.enum(['delayed', 'skipped', 'unavailable']) }),
]);

export const detectorFrameAnalysis = z.union([
  replayFrameAnalysis,
  z.object({ state: z.literal('analyzed'), people: z.array(detectionGeometry).max(300) }).transform(({ state, people }) => ({
    state,
    detections: people.map((person) => ({ ...person, objectType: 'person' as const })),
  })),
]);

export type ReplayFrameAnalysis = z.infer<typeof replayFrameAnalysis>;
