import { and, asc, eq, isNotNull, isNull, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { requireEnv } from './require-env.js';
import { authUser, cameraEndpointAdministrators, cameraEndpoints, cameraRecordings, cameras, cameraZones, operationalEvents, replayPasses } from './schema.js';

export { normalizeCameraEndpoint, streamEndpoint } from './camera-endpoint.js';
export { cameraRecordings, cameras, cameraZones, operationalEvents, replayPasses } from './schema.js';

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
    id: cameras.id,
    name: cameras.name,
    durationMs: cameras.durationMs,
  };
  const recordingFields = {
    id: cameraRecordings.id,
    startedAt: cameraRecordings.startedAt,
    endedAt: cameraRecordings.endedAt,
  };
  const cameraScope = (tenantId: string, id: string) => and(eq(cameras.tenantId, tenantId), eq(cameras.id, id));
  const recordingScope = (tenantId: string, cameraId: string) =>
    and(eq(cameraRecordings.tenantId, tenantId), eq(cameraRecordings.cameraId, cameraId));
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
    endpoints: {
      async canManage(userId: string) {
        const [admin] = await database.select({ id: cameraEndpointAdministrators.userId })
          .from(cameraEndpointAdministrators).where(eq(cameraEndpointAdministrators.userId, userId));
        return Boolean(admin);
      },
      async list() {
        const rows = await database.select().from(cameraEndpoints).orderBy(asc(cameraEndpoints.endpoint));
        return rows.map(({ endpoint }) => endpoint);
      },
      async contains(endpoint: string) {
        const [row] = await database.select().from(cameraEndpoints).where(eq(cameraEndpoints.endpoint, endpoint));
        return Boolean(row);
      },
      async add(userId: string, endpoint: string) {
        await forTenant(userId, (tx) => tx.insert(cameraEndpoints).values({ endpoint }).onConflictDoNothing());
      },
      async remove(userId: string, endpoint: string) {
        await forTenant(userId, (tx) => tx.delete(cameraEndpoints).where(eq(cameraEndpoints.endpoint, endpoint)));
      },
    },
    cameras: {
      list(tenantId: string) {
        return forTenant(tenantId, (tx) => tx.select(cameraFields).from(cameras)
          .where(and(eq(cameras.tenantId, tenantId), isNull(cameras.removedAt)))
          .orderBy(asc(cameras.createdAt), asc(cameras.id)));
      },
      async find(tenantId: string, id: string) {
        const [camera] = await forTenant(tenantId, (tx) => tx.select({
          ...cameraFields, startOffsetMs: cameras.startOffsetMs,
        }).from(cameras)
          .where(and(cameraScope(tenantId, id), isNull(cameras.removedAt))));
        return camera;
      },
      async add(tenantId: string, camera: Pick<typeof cameras.$inferInsert, 'id' | 'name' | 'durationMs' | 'startOffsetMs'>) {
        await forTenant(tenantId, (tx) => tx.insert(cameras).values({ ...camera, tenantId }));
      },
      async recordPass(tenantId: string, pass: { cameraId: string; id: string }) {
        await forTenant(tenantId, (tx) => tx.insert(replayPasses).values({ ...pass, tenantId }));
      },
      async addIp(tenantId: string, camera: { id: string; name: string; encryptedStream: string }) {
        await forTenant(tenantId, (tx) => tx.insert(cameras).values({ ...camera, tenantId }));
      },
      async removeIp(tenantId: string, id: string) {
        const [removed] = await forTenant(tenantId, (tx) => tx.update(cameras)
          .set({ removedAt: new Date(), encryptedStream: null })
          .where(and(cameraScope(tenantId, id), isNotNull(cameras.encryptedStream))).returning({ id: cameras.id }));
        return Boolean(removed);
      },
      async *captureSources() {
        const tenants = await database.select({ id: authUser.id }).from(authUser);
        for (const { id: tenantId } of tenants) {
          const sources = await forTenant(tenantId, (tx) => tx.select({
            id: cameras.id, encryptedStream: cameras.encryptedStream,
          }).from(cameras).where(and(eq(cameras.tenantId, tenantId), isNotNull(cameras.encryptedStream))));
          for (const source of sources) yield { ...source, tenantId };
        }
      },
    },
    recordings: {
      list(tenantId: string, cameraId: string) {
        return forTenant(tenantId, (tx) => tx.select(recordingFields).from(cameraRecordings)
          .where(recordingScope(tenantId, cameraId)).orderBy(asc(cameraRecordings.startedAt)));
      },
      async find(tenantId: string, cameraId: string, id: string) {
        const [recording] = await forTenant(tenantId, (tx) => tx.select({ id: cameraRecordings.id }).from(cameraRecordings)
          .where(and(recordingScope(tenantId, cameraId), eq(cameraRecordings.id, id))));
        return recording;
      },
      async add(tenantId: string, recording: Pick<typeof cameraRecordings.$inferInsert, 'id' | 'cameraId' | 'startedAt' | 'endedAt'>) {
        await forTenant(tenantId, (tx) => tx.insert(cameraRecordings).values({ ...recording, tenantId }));
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
