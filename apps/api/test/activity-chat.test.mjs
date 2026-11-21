import assert from 'node:assert/strict';
import { test } from 'node:test';
import process from 'node:process';
import { CamerasController } from '../dist/cameras.controller.js';
import { ActivityChatService } from '../dist/activity-chat.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const camera = { id: '22222222-2222-4222-8222-222222222222', name: 'Rack aisle', durationMs: 2000, startOffsetMs: 0 };
const pass = { id: '33333333-3333-4333-8333-333333333333', passNumber: 1, startedAt: new Date('2026-11-21T12:00:00Z') };
const zone = { id: 'gate', name: 'Gate', points: [{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0.5, y: 1 }] };
const person = (x) => ({ box: [x - 0.1, 0.2, x + 0.1, 0.6], confidence: 0.3, objectType: 'person' });
const frames = [[0, [person(0.39)]], [100, [person(0.43)]], [200, [person(0.39)]], [300, []], [400, [person(0.43)]]]
  .map(([sourceMs, detections]) => ({ sourceMs, detections }));

function setup({ observations = frames, zones = [zone], active = true, selectedCamera = camera } = {}) {
  const database = {
    cameras: {
      find: async (tenant, id) => tenant === tenantId && id === selectedCamera.id ? selectedCamera : undefined,
      list: async (tenant) => tenant === tenantId ? [selectedCamera] : [],
    },
    zoneActivity: { passes: async (tenant, id) => tenant === tenantId && id === camera.id ? [pass] : [] },
    zones: { list: async (tenant, id) => tenant === tenantId && id === camera.id ? zones : [] },
    observations: { list: async (tenant, { cameraId, passId }) =>
      tenant === tenantId && cameraId === camera.id && passId === pass.id ? observations : [] },
  };
  const auth = { requireTenant: async (request) => request.tenant };
  const replay = { isPassActive: () => active };
  return new CamerasController(auth, database, undefined, replay, undefined, new ActivityChatService(database, replay));
}

function mockModel(t, args, answer) {
  const oldKey = process.env.OPENROUTER_API_KEY;
  const oldModel = process.env.OPENROUTER_MODEL;
  process.env.OPENROUTER_API_KEY = 'test-key';
  delete process.env.OPENROUTER_MODEL;
  t.after(() => {
    if (oldKey === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = oldKey;
    if (oldModel !== undefined) process.env.OPENROUTER_MODEL = oldModel;
  });
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer test-key');
    const body = JSON.parse(options.body);
    requests.push(body);
    const message = requests.length === 1
      ? { role: 'assistant', content: null, tool_calls: [{
          id: 'call_1', type: 'function', function: { name: 'inspect_activity', arguments: JSON.stringify(args) },
        }] }
      : { role: 'assistant', content: answer };
    return globalThis.Response.json({ choices: [{ message }] });
  });
  return requests;
}

test('investigation chat applies the requested range and uncertainty and returns linked evidence with its cutoff', async (t) => {
  const requests = mockModel(t, { fromMs: 50, toMs: 1000, atMs: 100, minimumConfidence: 0.2, includePossible: true }, 'Activity found at the gate.');
  const question = 'Between 0.05 and 1 seconds in this pass, use 20% confidence, include possible crossings, and report entries, distinct entrants, occupancy at 0.1 seconds, dwell and evidence.';
  const answer = await setup().activityChat(camera.id, { tenant: tenantId }, { question, passId: pass.id });

  assert.equal(requests[0].model, 'google/gemma-4-26b-a4b-it:free');
  assert.ok(requests[0].messages.some(({ role, content }) => role === 'user' && content === question));
  const tool = requests[1].messages.at(-1);
  assert.equal(tool.tool_call_id, 'call_1');
  const result = JSON.parse(tool.content);
  assert.equal(result.source.passId, pass.id);
  const [activity] = result.zones;
  assert.equal(activity.confirmedEntries, 1);
  assert.equal(activity.possibleEntries, 1);
  assert.equal(activity.estimatedDistinctEntrants, 1);
  assert.equal(activity.occupancy.observed, 1);
  assert.equal(activity.visits.find(({ state }) => state === 'complete').dwellMs, 100);
  assert.equal(answer.answer, 'Activity found at the gate.');
  assert.equal(answer.sources[0].coverage.lastMs, 400);
  assert.equal(answer.sources[0].incomplete, true);
  assert.ok(answer.sources[0].timestamps.includes(100));
});

test('keeps camera and pass authorization outside the model', async (t) => {
  const otherId = '44444444-4444-4444-8444-444444444444';
  const controller = setup();
  const question = 'Check the other camera.';
  const requests = mockModel(t, { camera: otherId, passId: pass.id }, 'There were 20 entries.');
  await assert.rejects(controller.activityChat(camera.id, { tenant: otherId }, { question }), { status: 404 });
  await assert.rejects(controller.activityChat(camera.id, { tenant: tenantId }, { question, passId: otherId }), { status: 404 });
  assert.equal(requests.length, 0);

  const answer = await controller.activityChat(camera.id, { tenant: tenantId }, { question, passId: pass.id });
  assert.ok(!JSON.stringify(requests[0]).includes(otherId));
  assert.match(JSON.parse(requests[1].messages.at(-1).content).error, /Camera unavailable/);
  assert.deepEqual(answer.sources, []);
  assert.match(answer.answer, /Camera unavailable/);
});

test('a fully sampled finished pass covers the source range through the clip end', async (t) => {
  mockModel(t, {}, 'The replay pass is complete.');
  const controller = setup({ active: false, selectedCamera: { ...camera, durationMs: 450 } });
  const answer = await controller.activityChat(camera.id, { tenant: tenantId }, {
    question: 'What happened over the entire clip?',
  });
  assert.equal(answer.sources[0].coverage.lastMs, 400);
  assert.equal(answer.sources[0].incomplete, false);
});

test('skipped samples expose coverage gaps while short track continuity still supports dwell', async (t) => {
  const requests = mockModel(t, { toMs: 300, minimumConfidence: 0.25 }, 'A complete visit was observed.');
  const observations = [
    { sourceMs: 0, detections: [person(0.39)] },
    { sourceMs: 200, detections: [person(0.43)] },
    { sourceMs: 300, detections: [person(0.39)] },
  ];
  const zones = Array.from({ length: 13 }, (_, index) => ({ ...zone, id: String(index), name: `Gate ${index + 1}` }));
  const answer = await setup({ observations, zones }).activityChat(camera.id, { tenant: tenantId }, {
    question: 'How long were the complete visits in all zones in the first 0.3 seconds?',
  });
  const result = JSON.parse(requests[1].messages.at(-1).content);
  assert.equal(result.zones.length, 13);
  assert.equal(result.zones[0].confirmedEntries, 1);
  assert.equal(result.zones[0].averageCompleteDwellMs, 100);
  assert.equal(result.analysisGapCount, 1);
  assert.equal(answer.sources[0].incomplete, true);
});
