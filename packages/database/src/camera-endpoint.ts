const hostAndPort = /^(?:[a-z0-9][a-z0-9.-]*|\[[a-f0-9:.]+\])(?::[0-9]+)?$/i;

export function normalizeCameraEndpoint(input: string) {
  const endpoint = input.trim();
  if (/[\s\\]|\p{Cc}/u.test(endpoint)) return;
  const hasScheme = /^rtsp:\/\//i.test(endpoint);
  if (!hasScheme && !hostAndPort.test(endpoint)) return;

  try {
    const url = new URL(hasScheme ? endpoint : `rtsp://${endpoint}`);
    if (url.username || url.password || url.hash) return;
    return streamEndpoint(url);
  } catch {
    return;
  }
}

export function streamEndpoint(url: URL) {
  if (url.protocol !== 'rtsp:' || !hostAndPort.test(url.host) || url.host.length > 260 || url.port === '0') return;
  return `${url.hostname.toLowerCase()}:${url.port || '554'}`;
}
