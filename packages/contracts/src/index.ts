import { z } from 'zod';

export { calibratedZoneInput, cameraZone, cameraZoneInput, cameraZoneList, maxZoneNameLength, maxZonePoints } from './camera-zone.js';
export type { CameraZone, CameraZoneInput, ZonePoint } from './camera-zone.js';

export const healthResponse = z.object({
  status: z.enum(['ready', 'unavailable']),
});

export type HealthResponse = z.infer<typeof healthResponse>;

export const maxCameraNameLength = 100;
export const maxCameraStreamUrlLength = 2048;
export const cameraName = z.string().trim().min(1).max(maxCameraNameLength);

export const ipCameraInput = z.object({
  name: cameraName,
  url: z.string().trim().min(1).max(maxCameraStreamUrlLength),
  username: z.string().max(256).default(''),
  password: z.string().max(256).default(''),
});
export type IpCameraInput = z.infer<typeof ipCameraInput>;

export const ipCamera = z.object({ id: z.uuid(), name: cameraName, kind: z.literal('ip') });
export const cameraList = z.array(ipCamera);
export type IpCamera = z.infer<typeof ipCamera>;

export const captureStatus = z.object({ state: z.enum(['connecting', 'connected', 'unavailable', 'blocked']) });
export type CaptureStatus = z.infer<typeof captureStatus>;

export const recordingList = z.array(z.object({
  id: z.uuid(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
}));

export const cameraEndpointInput = z.object({ endpoint: z.string().trim().min(1).max(maxCameraStreamUrlLength) });
export const cameraEndpointSettings = z.object({
  canManage: z.boolean(),
  endpoints: z.array(z.string()),
});

export { detectorFrameAnalysis, replayFrameAnalysis, warehouseObjectLabels, warehouseObjectType } from './replay-analysis.js';
export type { ObjectDetection, ReplayFrameAnalysis, WarehouseObjectType } from './replay-analysis.js';
export { zoneEntryEvidence, zoneEntryHistory, zoneEntryRule, zoneEntryRuleInput, zoneEntryRuleList, zoneEntryRuleToggle, zoneRuleEventType } from './zone-entry.js';
export type { ZoneCrossingDirection, ZoneEntryEvent, ZoneEntryRule, ZoneEntryRuleInput, ZoneRuleEventType } from './zone-entry.js';
export { zoneActivity, zoneActivityFrame, zoneActivityPasses, zoneActivityRuleKey } from './zone-activity.js';
export type { ZoneActivity, ZoneActivityFrame } from './zone-activity.js';
export { calibrateGroundZone } from './ground-zone.js';
export type { GroundZone, GroundDecision } from './ground-zone.js';
