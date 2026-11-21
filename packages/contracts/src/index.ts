import { z } from 'zod';

export { cameraZone, cameraZoneInput, cameraZoneList, maxZoneNameLength, maxZonePoints } from './camera-zone.js';
export type { CameraZone, CameraZoneInput, ZonePoint } from './camera-zone.js';

export const healthResponse = z.object({
  status: z.enum(['ready', 'unavailable']),
});

export type HealthResponse = z.infer<typeof healthResponse>;

export const maxCameraNameLength = 100;
export const maxCameraStreamUrlLength = 2048;
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

export const ipCameraInput = z.object({
  name: cameraName,
  url: z.string().trim().min(1).max(maxCameraStreamUrlLength),
  username: z.string().max(256).default(''),
  password: z.string().max(256).default(''),
});
export type IpCameraInput = z.infer<typeof ipCameraInput>;

export const ipCamera = syntheticCamera.pick({ id: true, name: true }).extend({ kind: z.literal('ip') });
export const cameraList = z.array(z.union([syntheticCamera, ipCamera]));
export type Camera = z.infer<typeof cameraList>[number];
export type IpCamera = z.infer<typeof ipCamera>;

export const captureStatus = z.object({ state: z.enum(['connecting', 'connected', 'unavailable', 'blocked']) });
export type CaptureStatus = z.infer<typeof captureStatus>;

export const recordingList = z.array(z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
}));

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


export const cameraEndpointInput = z.object({ endpoint: z.string().trim().min(1).max(maxCameraStreamUrlLength) });
export const cameraEndpointSettings = z.object({
  canManage: z.boolean(),
  endpoints: z.array(z.string()),
});

export { detectorFrameAnalysis, replayFrameAnalysis, replayImage, warehouseObjectLabels, warehouseObjectType } from './replay-analysis.js';
export type { ObjectDetection, ReplayFrameAnalysis, ReplayImage, WarehouseObjectType } from './replay-analysis.js';
export { zoneEntryEvidence, zoneEntryHistory, zoneEntryRule, zoneEntryRuleInput, zoneEntryRuleList, zoneEntryRuleToggle, zoneRuleEventType } from './zone-entry.js';
export type { ZoneCrossingDirection, ZoneEntryEvent, ZoneEntryRule, ZoneEntryRuleInput, ZoneRuleEventType } from './zone-entry.js';
export { zoneActivity, zoneActivityFrame, zoneActivityPasses, zoneActivityRuleKey } from './zone-activity.js';
export type { ZoneActivity, ZoneActivityFrame } from './zone-activity.js';
export { activityChatInput, activityChatResponse, activityQuery, maxActivityQuestionLength } from './activity-chat.js';
export type { ActivityChatInput, ActivityChatSource, ActivityQuery } from './activity-chat.js';
