import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { sql } from 'drizzle-orm';
import { migrateDatabase } from '../dist/migrate.js';
import { createDatabase, operationalEvents } from '../dist/index.js';

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
