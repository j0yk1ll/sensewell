import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { migrateDatabase } from '../dist/migrate.js';
import { cameraZones, createDatabase, operationalEvents } from '../dist/index.js';

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
});
