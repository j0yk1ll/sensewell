import { cameraEndpointSettings, dwellTrigger, triggerDraft, triggerPreview, triggerWorkspace, cameraList, cameraZone, cameraZoneList, captureStatus, ipCamera, recordingList, type CameraZoneInput, type IpCameraInput, type TriggerRange } from '@sensewell/contracts';

export class CameraApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function checkedRequest(path: string, message: string, options?: RequestInit) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new CameraApiError(response.status,
      response.status < 500 && typeof problem?.message === 'string' ? problem.message : message);
  }
  return response;
}

async function request<T>(
  path: string,
  schema: { parse(value: unknown): T },
  message: string,
  options?: RequestInit,
) {
  const response = await checkedRequest(path, message, options);
  return schema.parse(await response.json());
}

const cameraPath = (id: string) => `/api/cameras/${id}`;
const zonePath = (id: string, zoneId: string) => `${cameraPath(id)}/zones/${zoneId}`;

const endpointPath = '/api/camera-endpoints';

export const cameraEndpointApi = {
  settings(signal: AbortSignal) {
    return request(endpointPath, cameraEndpointSettings, 'Could not load camera endpoint settings.', { signal });
  },
  async approve(endpoint: string) {
    await checkedRequest(endpointPath, 'Could not approve the camera endpoint.', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ endpoint }),
    });
  },
  async revoke(endpoint: string) {
    await checkedRequest(`${endpointPath}/${encodeURIComponent(endpoint)}`, 'Could not revoke the camera endpoint.', {
      method: 'DELETE',
    });
  },
};

export const cameraApi = {
  list(signal: AbortSignal) {
    return request('/api/cameras', cameraList, 'Could not load cameras.', { signal });
  },
  connect(input: IpCameraInput) {
    return request('/api/cameras/ip', ipCamera, 'Could not connect the camera. Try again.', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  },
  async remove(id: string) {
    await checkedRequest(cameraPath(id), 'Could not remove the camera. Try again.', { method: 'DELETE' });
  },
  capture(id: string, signal: AbortSignal) {
    return request(`${cameraPath(id)}/capture`, captureStatus, 'Could not load capture status.', { signal });
  },
  liveVideo: (id: string) => `${cameraPath(id)}/capture/video`,
  recordings(id: string, signal: AbortSignal) {
    return request(`${cameraPath(id)}/recordings`, recordingList, 'Could not load recordings.', { signal });
  },
  recording: (id: string, recordingId: string) => `${cameraPath(id)}/recordings/${recordingId}`,
  zones(id: string, signal: AbortSignal) {
    return request(`${cameraPath(id)}/zones`, cameraZoneList, 'Could not load camera zones.', { signal });
  },
  addZone(id: string, zone: CameraZoneInput) {
    return request(`${cameraPath(id)}/zones`, cameraZone, 'Could not save the zone. Try again.', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(zone),
    });
  },
  updateZone(id: string, zoneId: string, zone: CameraZoneInput) {
    return request(zonePath(id, zoneId), cameraZone, 'Could not update the zone. Try again.', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(zone),
    });
  },
  async removeZone(id: string, zoneId: string) {
    await checkedRequest(zonePath(id, zoneId), 'Could not remove the zone. Try again.', { method: 'DELETE' });
  },
};

export function cameraZoneQuery(id: string, tenantId: string) {
  return {
    queryKey: ['camera-zones', tenantId, id],
    queryFn: ({ signal }: { signal: AbortSignal }) => cameraApi.zones(id, signal),
    retry: false,
  };
}

const triggerPath = (cameraId: string) => `${cameraPath(cameraId)}/triggers`;

export const triggerApi = {
  evidence: (cameraId: string, eventId: string, recordingId: string) =>
    `${cameraPath(cameraId)}/trigger-events/${eventId}/recordings/${recordingId}`,
  workspace(cameraId: string, signal: AbortSignal) {
    return request(triggerPath(cameraId), triggerWorkspace, 'Could not load triggers.', { signal });
  },
  draft(cameraId: string, zoneId: string, description: string) {
    return request(triggerPath(cameraId), triggerDraft, 'Could not interpret the request. Check your language model configuration.', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ zoneId, request: description }),
    });
  },
  setEnabled(cameraId: string, triggerId: string, enabled: boolean) {
    return request(`${triggerPath(cameraId)}/${triggerId}/enabled`, dwellTrigger, 'Could not update the trigger.', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    });
  },
  preview(cameraId: string, triggerId: string, range: TriggerRange) {
    return request(`${triggerPath(cameraId)}/${triggerId}/preview`, triggerPreview, 'Could not preview the condition.', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(range),
    });
  },
};
