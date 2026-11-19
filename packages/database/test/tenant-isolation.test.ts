import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { Client } from 'pg';
import { migrateDatabase } from '../dist/migrate.js';
import { cameraRecordings, cameraZones, createDatabase, normalizeCameraEndpoint, operationalEvents } from '../dist/index.js';

test('PostgreSQL isolates operational events under the application role', async (t) => {
  await migrateDatabase();

  const database = createDatabase({ max: 1 });
  t.after(() => database.close());

  const owner = randomUUID();
  const otherTenant = randomUUID();
  const event = { id: randomUUID(), tenantId: owner, occurredAt: new Date() };

  await database.forTenant(owner, async (tx) => {
    const { rows } = await tx.execute<{ role: string; rls: boolean }>(
      sql`select current_user as role, row_security_active('operational_events') as rls`,
    );
    assert.deepEqual(rows, [{ role: 'sensewell_app', rls: true }]);
    await tx.insert(operationalEvents).values(event);
  });

  assert.deepEqual(
    await database.forTenant(otherTenant, (tx) => tx.select().from(operationalEvents)),
    [],
  );
  assert.deepEqual(
    await database.forTenant(owner, (tx) => tx.select().from(operationalEvents)),
    [event],
  );

  await assert.rejects(
    database.forTenant(otherTenant, (tx) =>
      tx.insert(operationalEvents).values({ ...event, id: randomUUID() }),
    ),
    (error: unknown) =>
      error instanceof Error && (error.cause as { code?: string } | undefined)?.code === '42501',
  );
});

test('camera zones persist in their camera and tenant context', async (t) => {
  await migrateDatabase();

  const database = createDatabase({ max: 1 });
  t.after(() => database.close());

  const tenant = randomUUID();
  const otherTenant = randomUUID();
  const cameraId = randomUUID();
  const siblingId = randomUUID();
  const camera = { name: 'Warehouse', durationMs: 1000, startOffsetMs: 0 };
  await database.cameras.add(tenant, { ...camera, id: cameraId });
  await database.cameras.add(tenant, { ...camera, id: siblingId });

  const input = {
    name: 'Rack-side aisle',
    points: [{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.4 }, { x: 0.4, y: 0.9 }],
  };
  const saved = await database.zones.add(tenant, cameraId, input);
  assert.deepEqual(saved, { id: saved.id, ...input });
  assert.deepEqual(await database.zones.list(tenant, cameraId), [saved]);
  assert.deepEqual(await database.zones.list(tenant, siblingId), []);
  assert.deepEqual(await database.zones.list(otherTenant, cameraId), []);
  assert.deepEqual(await database.forTenant(otherTenant, (tx) => tx.select().from(cameraZones)), []);

  await assert.rejects(
    database.forTenant(otherTenant, (tx) =>
      tx.insert(cameraZones).values({ ...input, tenantId: tenant, cameraId }),
    ),
    (error: unknown) =>
      error instanceof Error && (error.cause as { code?: string } | undefined)?.code === '42501',
  );
  await assert.rejects(
    database.zones.add(otherTenant, cameraId, input),
    (error: unknown) =>
      error instanceof Error && (error.cause as { code?: string } | undefined)?.code === '23503',
  );

  const second = await database.zones.add(tenant, cameraId, { ...input, name: 'Loading bay' });
  const edits = {
    name: 'Main aisle',
    points: [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.3 }, { x: 0.6, y: 0.8 }],
  };
  const updated = { id: saved.id, ...edits };
  assert.equal(await database.zones.update(tenant, siblingId, saved.id, edits), undefined);
  assert.equal(await database.zones.update(otherTenant, cameraId, saved.id, edits), undefined);
  assert.deepEqual(await database.zones.update(tenant, cameraId, saved.id, edits), updated);
  assert.deepEqual(
    new Map((await database.zones.list(tenant, cameraId)).map((zone) => [zone.id, zone])),
    new Map([[updated.id, updated], [second.id, second]]),
  );
  assert.equal(await database.zones.remove(tenant, siblingId, saved.id), false);
  assert.equal(await database.zones.remove(otherTenant, cameraId, saved.id), false);
  assert.equal(await database.zones.remove(tenant, cameraId, saved.id), true);
  assert.equal(await database.zones.remove(tenant, cameraId, saved.id), false);
  assert.deepEqual(await database.zones.list(tenant, cameraId), [second]);
});

test('IP camera recordings are private to their camera and tenant', async (t) => {
  await migrateDatabase();

  const database = createDatabase({ max: 1 });
  t.after(() => database.close());

  const tenant = randomUUID();
  const otherTenant = randomUUID();
  const cameraId = randomUUID();
  const siblingId = randomUUID();
  const camera = { name: 'Warehouse', encryptedStream: 'opaque camera configuration' };
  await database.cameras.addIp(tenant, { ...camera, id: cameraId });
  await database.cameras.addIp(tenant, { ...camera, id: siblingId });

  const segment = { id: randomUUID(), startedAt: new Date(0), endedAt: new Date(5000) };
  await database.recordings.add(tenant, { ...segment, cameraId });

  assert.deepEqual(await database.recordings.list(tenant, cameraId), [segment]);
  assert.equal(await database.recordings.find(otherTenant, cameraId, segment.id), undefined);
  assert.equal(await database.recordings.find(tenant, siblingId, segment.id), undefined);
  assert.deepEqual(await database.forTenant(otherTenant, (tx) => tx.select().from(cameraRecordings)), []);
  assert.equal(await database.cameras.removeIp(otherTenant, cameraId), false);
  assert.equal(await database.cameras.removeIp(tenant, cameraId), true);
  assert.equal(await database.cameras.find(tenant, cameraId), undefined);
  assert.deepEqual(await database.recordings.list(tenant, cameraId), [segment]);
});

test('only endpoint administrators can change camera approvals', async (t) => {
  await migrateDatabase();

  const database = createDatabase({ max: 1 });
  t.after(() => database.close());

  const administrator = randomUUID();
  const operator = randomUUID();
  const endpoint = normalizeCameraEndpoint(`Camera-${randomUUID()}.test`);
  assert.ok(endpoint);
  assert.ok(endpoint.endsWith('.test:554'));

  const owner = new Client({ connectionString: process.env.DATABASE_MIGRATION_URL });
  await owner.connect();
  t.after(() => owner.end());
  await owner.query('insert into "user" (id, name, email) values ($1, $2, $3)',
    [administrator, 'Camera administrator', `${administrator}@example.test`]);
  await owner.query('insert into camera_endpoint_administrators (user_id) values ($1)', [administrator]);

  assert.equal(await database.endpoints.canManage(administrator), true);
  assert.equal(await database.endpoints.canManage(operator), false);
  await assert.rejects(database.endpoints.add(operator, endpoint),
    (error: unknown) => error instanceof Error && (error.cause as { code?: string } | undefined)?.code === '42501');

  await database.endpoints.add(administrator, endpoint);
  await database.endpoints.add(administrator, endpoint);
  assert.equal((await database.endpoints.list()).filter((value) => value === endpoint).length, 1);
  await database.endpoints.remove(operator, endpoint);
  assert.equal(await database.endpoints.contains(endpoint), true);
  await database.endpoints.remove(administrator, endpoint);
  assert.equal(await database.endpoints.contains(endpoint), false);
});

test('camera approvals accept RTSP URLs and keep only the endpoint', () => {
  assert.equal(normalizeCameraEndpoint('rtsp://rtsp.143b.ch:554'), 'rtsp.143b.ch:554');
  assert.equal(normalizeCameraEndpoint('rtsp://CAMERA.test/live?channel=1'), 'camera.test:554');
  assert.equal(normalizeCameraEndpoint('rtsp://[2001:0db8::1]:8554/live'), '[2001:db8::1]:8554');
  assert.equal(normalizeCameraEndpoint('[2001:0db8::1]:8554'), '[2001:db8::1]:8554');
  assert.equal(normalizeCameraEndpoint('camera.test:65536'), undefined);
  assert.equal(normalizeCameraEndpoint('camera.test/live'), undefined);
  assert.equal(normalizeCameraEndpoint('https://camera.test/live'), undefined);
  assert.equal(normalizeCameraEndpoint('rtsp://user:pass@camera.test/live'), undefined);
});
