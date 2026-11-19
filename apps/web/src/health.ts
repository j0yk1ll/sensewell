import { healthResponse } from '@sensewell/contracts';

export async function fetchHealth(signal: AbortSignal) {
  const response = await fetch('/api/health', { signal });
  if (!response.ok && response.status !== 503) {
    throw new Error('Could not reach the Sensewell API');
  }
  return healthResponse.parse(await response.json());
}
