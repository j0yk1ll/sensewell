import { and, asc, eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { requireEnv } from './require-env.js';
import { operationalEvents, replayPasses, syntheticCameras } from './schema.js';

export { operationalEvents, replayPasses, syntheticCameras } from './schema.js';

type TenantTransaction = Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0];

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
    close() {
      return pool.end();
    },
  };
}
