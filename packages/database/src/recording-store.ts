import { and, eq } from 'drizzle-orm';
import { cameraRecordings } from './schema.js';

export const recordingFields = {
  id: cameraRecordings.id,
  startedAt: cameraRecordings.startedAt,
  endedAt: cameraRecordings.endedAt,
};

export const recordingScope = (tenantId: string, cameraId: string) =>
  and(eq(cameraRecordings.tenantId, tenantId), eq(cameraRecordings.cameraId, cameraId));
