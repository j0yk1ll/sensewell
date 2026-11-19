import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { requireEnv } from './require-env.js';
import { cameraZones, operationalEvents, replayPasses, syntheticCameras } from './schema.js';

export { cameraZones, operationalEvents, replayPasses, syntheticCameras } from './schema.js';

type TenantTransaction = Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0];
type ZoneInput = Pick<typeof cameraZones.$inferInsert, 'name' | 'points'>;

function zoneCamera(tenantId: string, cameraId: string) {
  return and(eq(cameraZones.tenantId, tenantId), eq(cameraZones.cameraId, cameraId));
}

export function createDatabase({ max }: { max?: number } = {}) {
  const pool = new Pool({
    connectionString: requireEnv('DATABASE_URL'),
    connectionTimeoutMillis: 3000,
    max,
  });
  pool.on('error', (error) => console.warn('Idle PostgreSQL connection failed:', error.message));
  const database = drizzle(pool);

  // The caller supplies the authorized tenant. PostgreSQL limits the setting to this transaction.
  function forTenant<T>(tenantId: string, query: (tx: TenantTransaction) => Promise<T>) {
    return database.transaction(async (tx) => {
      await tx.execute(sql`select set_config('sensewell.tenant_id', ${tenantId}, true)`);
      return query(tx);
    });
  }

  const cameraFields = {
    id: syntheticCameras.id,
    name: syntheticCameras.name,
    durationMs: syntheticCameras.durationMs,
  };
  const zoneFields = {
    id: cameraZones.id,
    name: cameraZones.name,
    points: cameraZones.points,
  };

  return {
    authPool: pool,
    async checkReadiness() {
      await database.execute(sql`select 1 from ${operationalEvents} where false`);
    },
    forTenant,
    cameras: {
      list(tenantId: string) {
        return forTenant(tenantId, (tx) => tx.select(cameraFields).from(syntheticCameras)
          .where(eq(syntheticCameras.tenantId, tenantId))
          .orderBy(asc(syntheticCameras.createdAt), asc(syntheticCameras.id)));
      },
      async find(tenantId: string, id: string) {
        const [camera] = await forTenant(tenantId, (tx) => tx.select({
          ...cameraFields, startOffsetMs: syntheticCameras.startOffsetMs,
        }).from(syntheticCameras)
          .where(and(eq(syntheticCameras.tenantId, tenantId), eq(syntheticCameras.id, id))));
        return camera;
      },
      async add(tenantId: string, camera: Pick<typeof syntheticCameras.$inferInsert, 'id' | 'name' | 'durationMs' | 'startOffsetMs'>) {
        await forTenant(tenantId, (tx) => tx.insert(syntheticCameras).values({ ...camera, tenantId }));
      },
      async recordPass(tenantId: string, pass: { cameraId: string; id: string }) {
        await forTenant(tenantId, (tx) => tx.insert(replayPasses).values({ ...pass, tenantId }));
      },
    },
    zones: {
      list(tenantId: string, cameraId: string) {
        return forTenant(tenantId, (tx) => tx.select(zoneFields).from(cameraZones)
          .where(zoneCamera(tenantId, cameraId))
          .orderBy(asc(cameraZones.createdAt), asc(cameraZones.id)));
      },
      async add(tenantId: string, cameraId: string, zone: ZoneInput) {
        const [saved] = await forTenant(tenantId, (tx) => tx.insert(cameraZones)
          .values({ ...zone, tenantId, cameraId }).returning(zoneFields));
        if (!saved) throw new Error('Zone insert returned no row.');
        return saved;
      },
      async update(tenantId: string, cameraId: string, id: string, zone: ZoneInput) {
        const [saved] = await forTenant(tenantId, (tx) => tx.update(cameraZones).set(zone)
          .where(and(zoneCamera(tenantId, cameraId), eq(cameraZones.id, id))).returning(zoneFields));
        return saved;
      },
      async remove(tenantId: string, cameraId: string, id: string) {
        const [removed] = await forTenant(tenantId, (tx) => tx.delete(cameraZones)
          .where(and(zoneCamera(tenantId, cameraId), eq(cameraZones.id, id))).returning({ id: cameraZones.id }));
        return Boolean(removed);
      },
    },
    close() {
      return pool.end();
    },
  };
}
