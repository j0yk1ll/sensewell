import console from 'node:console';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { clearInterval, setInterval } from 'node:timers';
import { URL } from 'node:url';

const [command, directory, profile = 'normal'] = process.argv.slice(2);
if (!['import', 'play', 'stop'].includes(command) || !directory || !['normal', 'delay', 'outage'].includes(profile)) {
  console.error('Usage: node scripts/warehouse-demo/replay.mjs <import|play|stop> <fixture-directory> [normal|delay|outage]');
  process.exit(2);
}

const origin = new URL(process.env.SENSEWELL_URL ?? 'http://localhost:3000').origin;
const names = ['staging', 'aisle', 'dispatch'];

async function request(path, options = {}) {
  const response = await globalThis.fetch(origin + path, { ...options, headers: { Origin: origin, ...options.headers } });
  if (!response.ok) throw new Error(`${options.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`);
  return response;
}

async function signIn() {
  const { SENSEWELL_EMAIL: email, SENSEWELL_PASSWORD: password } = process.env;
  if (!email || !password) throw new Error('Set SENSEWELL_EMAIL and SENSEWELL_PASSWORD for an existing Sensewell account.');
  const response = await request('/api/auth/sign-in/email', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  return response.headers.getSetCookie().map((cookie) => cookie.split(';')[0]).join('; ');
}

async function main() {
  const readManifest = async (path) => JSON.parse(await readFile(join(path, 'manifest.json'), 'utf8'));
  const baseManifest = await readManifest(directory);
  const fault = baseManifest.faultProfiles?.[profile];
  if (profile !== 'normal' && !fault) throw new Error('Use the supported-handoff fixture for fault profiles.');
  const selectedDirectory = fault?.gapFixture ? resolve(directory, '..', fault.gapFixture) : directory;
  const manifest = fault?.gapFixture ? await readManifest(selectedDirectory) : baseManifest;
  const statePath = join(selectedDirectory, 'replay-cameras.json');
  const cookie = await signIn();
  const api = (path, options = {}) => request('/api/cameras' + path, {
    ...options, headers: { Cookie: cookie, ...options.headers },
  });
  const sendJson = (path, body) => api(path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const saved = await readFile(statePath, 'utf8').then(JSON.parse, (error) => {
    if (error.code !== 'ENOENT') throw error;
    return {};
  });
  const accountKey = JSON.stringify([origin, process.env.SENSEWELL_EMAIL]);
  const cameras = saved[accountKey] ??= {};

  if (command === 'import') {
    const registered = new Set((await (await api('')).json()).map(({ id }) => id));
    for (const name of names) {
      if (!registered.has(cameras[name])) {
        const path = join(selectedDirectory, manifest.cameras[name].file);
        const filename = `Warehouse ${manifest.scenario} ${name}`;
        const created = await api(`?name=${encodeURIComponent(filename)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String((await stat(path)).size) },
          body: createReadStream(path), duplex: 'half',
        });
        cameras[name] = (await created.json()).id;
        await writeFile(statePath, JSON.stringify(saved, null, 2) + '\n');
      }
      const existing = await (await api(`/${cameras[name]}/zones`)).json();
      for (const [zone, points] of Object.entries(manifest.cameras[name].zones)) {
        if (!existing.some((savedZone) => savedZone.name === zone)) {
          await sendJson(`/${cameras[name]}/zones`, { name: zone, points });
        }
      }
      console.log(`${name} ${cameras[name]}`);
    }
    return;
  }

  if (names.some((name) => !cameras[name])) throw new Error('Import this fixture before replaying it.');
  const stop = (passes) => Promise.allSettled(passes.map(({ cameraId, passId }) => {
    const query = passId ? `?passId=${encodeURIComponent(passId)}` : '';
    return api(`/${cameraId}/replay${query}`, { method: 'DELETE' });
  }));
  if (command === 'stop') {
    const failures = (await stop(names.map((name) => ({ cameraId: cameras[name] })))).filter(({ status }) => status === 'rejected');
    if (failures.length) throw new AggregateError(failures.map(({ reason }) => reason), 'Could not stop all replays.');
    return;
  }

  const bufferMs = fault?.bufferMs ?? 2500;
  const tracks = names.map((name) => {
    const gap = manifest.coverageGaps.find(({ camera }) => camera === name);
    return {
      cameraId: cameras[name], delayMs: fault?.delaysMs?.[name],
      gap: gap && { startMs: gap.startMs, endMs: gap.endMs },
    };
  });
  const abort = new globalThis.AbortController();
  const interrupt = () => abort.abort();
  process.once('SIGINT', interrupt);
  let run;
  let timer;
  try {
    run = await (await sendJson('/replay-group', { bufferMs, tracks })).json();
    console.log(JSON.stringify({ ...run, cameras, profile, bufferMs }));
    const states = Object.fromEntries(names.map((name) => [name, { state: 'waiting' }]));
    const publishStatus = () => console.log(JSON.stringify({ elapsedMs: Date.now() - Date.parse(run.startedAt), ...states }));
    timer = setInterval(publishStatus, 1000);
    await Promise.all(names.map(async (name) => {
      const response = await api(`/${cameras[name]}/replay/frames`, { signal: abort.signal });
      const lines = createInterface({ input: Readable.fromWeb(response.body), crlfDelay: Infinity });
      for await (const line of lines) {
        const frame = JSON.parse(line);
        const reading = states[name];
        if (frame.analysis.state === 'analyzed') reading.lastAnalyzedMs = frame.sourceMs;
        reading.state = frame.analysis.state;
        reading.sourceMs = frame.sourceMs;
        reading.analyzedFrames = frame.analyzedFrames;
        reading.lagMs = Date.now() - Date.parse(run.startedAt) - frame.sourceMs;
      }
      const status = await (await api(`/${cameras[name]}/replay`)).json();
      if (status.state !== 'finished') throw new Error(`${name} replay ended in state ${status.state}.`);
      states[name].state = 'finished';
    }));
    publishStatus();
  } catch (error) {
    if (run) await stop(run.passes);
    if (!abort.signal.aborted) throw error;
  } finally {
    clearInterval(timer);
    abort.abort();
    process.removeListener('SIGINT', interrupt);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
