import { z } from 'zod';

export { cameraZone, cameraZoneInput, cameraZoneList, maxZoneNameLength, maxZonePoints } from './camera-zone.js';
export type { CameraZone, CameraZoneInput, ZonePoint } from './camera-zone.js';

export const healthResponse = z.object({
  status: z.enum(['ready', 'unavailable']),
});

export type HealthResponse = z.infer<typeof healthResponse>;

export const maxCameraNameLength = 100;
export const maxClipMiB = 512;
export const maxClipBytes = maxClipMiB * 1024 * 1024;
export const cameraName = z.string().trim().min(1).max(maxCameraNameLength);

export const syntheticCamera = z.object({
  id: z.uuid(),
  name: cameraName,
  durationMs: z.number().int().positive(),
});
export const syntheticCameraList = z.array(syntheticCamera);
export type SyntheticCamera = z.infer<typeof syntheticCamera>;

export const replayOptions = z.object({ loop: z.boolean() });
export const replayStatus = z.discriminatedUnion('state', [
  z.object({ state: z.enum(['idle', 'starting', 'stopping', 'finished', 'unavailable']) }),
  z.object({
    state: z.literal('running'),
    passId: z.uuid(),
    passNumber: z.number().int().positive(),
    sourceMs: z.number().int().nonnegative(),
  }),
]);
export type ReplayStatus = z.infer<typeof replayStatus>;
