import type { Readable } from 'node:stream';

export function jpegPart(jpeg: Buffer) {
  return Buffer.concat([
    Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${jpeg.length}\r\n\r\n`),
    jpeg,
    Buffer.from('\r\n'),
  ]);
}

export async function* jpegFrames(stream: Readable) {
  let buffer = Buffer.alloc(0);
  for await (const chunk of stream) {
    buffer = Buffer.concat([buffer, chunk]);
    for (;;) {
      const headerEnd = buffer.indexOf('\r\n\r\n');
      if (headerEnd < 0) {
        if (buffer.length > 256) throw new Error('Invalid frame header');
        break;
      }
      const header = buffer.toString('ascii', 0, headerEnd);
      const length = Number(/\r\ncontent-length: (\d+)/i.exec(header)?.[1]);
      if (!Number.isInteger(length) || length < 1 || length > 1024 * 1024) {
        throw new Error('Invalid frame length');
      }
      const start = headerEnd + 4;
      const end = start + length;
      if (buffer.length < end) break;
      yield buffer.subarray(start, end);
      buffer = buffer.subarray(end);
    }
  }
}
