import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';
import type { IpCameraInput } from '@sensewell/contracts';

export function cameraStream(input: IpCameraInput) {
  if (/[\s\\]|\p{Cc}/u.test(input.url) || /[:\p{Cc}]/u.test(input.username)
    || /\p{Cc}/u.test(input.password)) return;
  let url: URL;
  try {
    url = new URL(input.url);
  } catch {
    return;
  }
  if (url.protocol !== 'rtsp:' || !url.hostname || url.username || url.password || url.hash
    || (input.password && !input.username)) return;

  url.username = input.username.replaceAll('%', '%25');
  url.password = input.password.replaceAll('%', '%25');
  return url;
}

function credentialsKey() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error('Camera credentials key is unavailable.');
  return Buffer.from(hkdfSync('sha256', secret, '', 'sensewell:ip-camera-stream', 32));
}

export function encryptStream(stream: URL) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', credentialsKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(stream.href, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString('base64');
}

export function decryptStream(encrypted: string) {
  const bytes = Buffer.from(encrypted, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', credentialsKey(), bytes.subarray(0, 12));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return new URL(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8'));
}
