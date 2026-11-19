import { replayStatus, syntheticCamera, syntheticCameraList } from '@sensewell/contracts';

export class CameraApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function request<T>(
  path: string,
  schema: { parse(value: unknown): T },
  message: string,
  options?: RequestInit,
) {
  const response = await fetch(path, options);
  if (!response.ok) {
    const problem = await response.json().catch(() => null);
    throw new CameraApiError(response.status,
      response.status < 500 && typeof problem?.message === 'string' ? problem.message : message);
  }
  return schema.parse(await response.json());
}

const cameraPath = (id: string) => `/api/cameras/${id}`;

export const cameraApi = {
  list(signal: AbortSignal) {
    return request('/api/cameras', syntheticCameraList, 'Could not load cameras.', { signal });
  },
  add(name: string, clip: File) {
    return request(`/api/cameras?${new URLSearchParams({ name })}`, syntheticCamera,
      'Could not save the clip. Try again.', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: clip,
      });
  },
  media: (id: string) => `${cameraPath(id)}/media`,
  video: (id: string) => `${cameraPath(id)}/replay/video`,
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
