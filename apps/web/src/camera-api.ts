import { activityChatResponse, type ActivityChatInput } from '@sensewell/contracts';
import { zoneActivity, zoneActivityPasses, zoneEntryEvidence, zoneEntryHistory, zoneEntryRule, zoneEntryRuleList, type ZoneEntryRuleInput } from '@sensewell/contracts';
import { cameraEndpointSettings, cameraList, cameraZone, cameraZoneList, captureStatus, ipCamera, recordingList, replayImage, replayStatus, syntheticCamera, type CameraZoneInput, type IpCameraInput } from '@sensewell/contracts';

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
  add(name: string, clip: File) {
    return request(`/api/cameras?${new URLSearchParams({ name })}`, syntheticCamera,
      'Could not save the clip. Try again.', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: clip,
      });
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
  media: (id: string) => `${cameraPath(id)}/media`,
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
  rules(id: string, signal: AbortSignal) {
    return request(`${cameraPath(id)}/zone-entry-rules`, zoneEntryRuleList, 'Could not load zone-entry rules.', { signal });
  },
  addRule(id: string, input: ZoneEntryRuleInput) {
    return request(`${cameraPath(id)}/zone-entry-rules`, zoneEntryRule, 'Could not save the rule.', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  },
  updateRule(id: string, ruleId: string, input: ZoneEntryRuleInput) {
    return request(`${cameraPath(id)}/zone-entry-rules/${ruleId}`, zoneEntryRule, 'Could not save the rule.', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
    });
  },
  async removeRule(id: string, ruleId: string) {
    await checkedRequest(`${cameraPath(id)}/zone-entry-rules/${ruleId}`, 'Could not remove the rule.', { method: 'DELETE' });
  },
  setRuleEnabled(id: string, ruleId: string, enabled: boolean) {
    return request(`${cameraPath(id)}/zone-entry-rules/${ruleId}/enabled`, zoneEntryRule, 'Could not update the rule.', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }),
    });
  },
  async activityChat(id: string, input: ActivityChatInput) {
    try {
      return await request(`${cameraPath(id)}/activity-chat`, activityChatResponse,
        'Could not get an answer from the chat model. Try again.', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
        });
    } catch (error) {
      if (error instanceof CameraApiError && error.status === 503) {
        throw new Error('Investigation chat is unavailable. Configure OPENROUTER_API_KEY on the server.', { cause: error });
      }
      throw error;
    }
  },
  activityPasses(id: string, signal: AbortSignal) {
    return request(`${cameraPath(id)}/zone-activity`, zoneActivityPasses, 'Could not load replay passes.', { signal });
  },
  zoneActivity(id: string, passId: string, atMs: number | undefined, signal: AbortSignal) {
    const query = atMs === undefined ? '' : `?atMs=${atMs}`;
    return request(`${cameraPath(id)}/zone-activity/${passId}${query}`, zoneActivity, 'Could not load zone activity.', { signal });
  },
  eventHistory(id: string, signal: AbortSignal) {
    return request(`${cameraPath(id)}/zone-entry-events`, zoneEntryHistory, 'Could not load event history.', { signal });
  },
  eventEvidence(id: string, eventId: string, signal: AbortSignal) {
    return request(`${cameraPath(id)}/zone-entry-events/${eventId}`, zoneEntryEvidence, 'Could not load event evidence.', { signal });
  },
  async eventEvidenceClip(id: string, eventId: string, signal: AbortSignal) {
    const response = await checkedRequest(`${cameraPath(id)}/zone-entry-events/${eventId}/clip`,
      'Could not load the evidence clip.', { signal });
    return response.blob();
  },
  async *replayFrames(id: string, signal: AbortSignal) {
    const response = await checkedRequest(`${cameraPath(id)}/replay/frames`, 'Could not load replay footage.', { signal });
    if (!response.body) throw new Error('Replay footage is unavailable.');
    const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffered = '';
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) {
          if (buffered) throw new Error('Incomplete replay frame.');
          return;
        }
        const lines = (buffered + value).split('\n');
        buffered = lines.pop() ?? '';
        for (const line of lines) yield replayImage.parse(JSON.parse(line));
      }
    } finally {
      await reader.cancel().catch(() => undefined);
      reader.releaseLock();
    }
  },
  status(id: string, signal: AbortSignal) {
    return request(`${cameraPath(id)}/replay`, replayStatus, 'Could not load replay status.', { signal });
  },
  start(id: string, loop: boolean) {
    return request(`${cameraPath(id)}/replay`, replayStatus,
      'Could not start replay. Check that the clip is available and try again.', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loop }),
      });
  },
  stop(id: string) {
    return request(`${cameraPath(id)}/replay`, replayStatus, 'Could not stop replay. Try again.', {
      method: 'DELETE',
    });
  },
};

export function cameraZoneQuery(id: string, tenantId: string) {
  return {
    queryKey: ['camera-zones', tenantId, id],
    queryFn: ({ signal }: { signal: AbortSignal }) => cameraApi.zones(id, signal),
    retry: false,
  };
}

export function zoneEntryRuleQuery(id: string, tenantId: string) {
  return {
    queryKey: ['zone-entry-rules', tenantId, id],
    queryFn: ({ signal }: { signal: AbortSignal }) => cameraApi.rules(id, signal),
    retry: false,
  };
}
