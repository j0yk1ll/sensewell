import { createConnection } from 'node:net';
import { detectorFrameAnalysis, type ReplayFrameAnalysis } from '@sensewell/contracts';

const detectorUrl = process.env.REPLAY_DETECTOR_URL;
export const replayDisplayDelayMs = 650;

export async function detectObjects(
  jpeg: Buffer, signal: AbortSignal, timeoutMs = replayDisplayDelayMs - 50,
): Promise<ReplayFrameAnalysis> {
  if (!detectorUrl) return { state: 'unavailable' };
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const endpoint = new URL(detectorUrl);
    const socket = createConnection({
      host: endpoint.hostname,
      port: Number(endpoint.port),
      signal: AbortSignal.any([signal, timeout]),
    });
    // Half-close after sending one JPEG. The worker then sends one JSON result and closes.
    socket.end(jpeg);
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of socket) {
      bytes += chunk.length;
      if (bytes > 256 * 1024) throw new Error('Detector response is too large.');
      chunks.push(chunk);
    }
    return detectorFrameAnalysis.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } catch {
    return { state: timeout.aborted ? 'delayed' : 'unavailable' };
  }
}
