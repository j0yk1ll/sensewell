const framesPerSecond = 10;
export const replayFrameIntervalMs = 1000 / framesPerSecond;

export function replayDecoderArgs(path: string, lengthMs: number, seekMs = 0) {
  return [
    '-nostdin', '-v', 'error', '-xerror', '-threads', '2', '-filter_threads', '1',
    '-protocol_whitelist', 'file', '-f', 'mov', ...(seekMs === 0 ? [] : ['-ss', String(seekMs / 1000)]),
    '-i', path, '-t', String(lengthMs / 1000),
    '-map', '0:V:0', '-vf', [
      'setpts=PTS-STARTPTS',
      `fps=${framesPerSecond}:start_time=0:round=up`,
      "scale=w='min(960,iw)':h='min(540,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
    ].join(','),
    '-c:v', 'mjpeg', '-threads', '1', '-f', 'mpjpeg', 'pipe:1',
  ];
}
