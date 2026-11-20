import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gte, isNotNull, isNull, lt, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { requireEnv } from './require-env.js';
import { authUser, cameraEndpointAdministrators, cameraEndpoints, cameraRecordings, cameras, cameraZones, operationalEvents, replayObservations, replayPasses, replayZoneEntries, zoneEntryRules } from './schema.js';

export { normalizeCameraEndpoint, streamEndpoint } from './camera-endpoint.js';
export { cameraRecordings, cameras, cameraZones, operationalEvents, replayObservations, replayPasses, replayZoneEntries, zoneEntryRules } from './schema.js';

type TenantTransaction = Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0];
type RuleInput = Pick<typeof zoneEntryRules.$inferInsert, 'name' | 'zoneId' | 'minimumConfidence' | 'eventType'>;
type Observation = Omit<typeof replayObservations.$inferInsert, 'tenantId' | 'eventJpeg'>;
type ActiveRule = Required<RuleInput> & { id: string; revision: number; zoneName: string; points: ZoneInput['points'] };
type ZoneInput = Pick<typeof cameraZones.$inferInsert, 'name' | 'points'>;

async function lockRuleZone(tx: TenantTransaction, tenantId: string, cameraId: string, zoneId: string) {
  const [zone] = await tx.select({ id: cameraZones.id }).from(cameraZones)
    .where(and(zoneCamera(tenantId, cameraId), eq(cameraZones.id, zoneId))).for('key share');
  return zone;
}

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

  const ruleFields = {
    id: zoneEntryRules.id,
    name: zoneEntryRules.name,
    zoneId: zoneEntryRules.zoneId,
    minimumConfidence: zoneEntryRules.minimumConfidence,
    eventType: zoneEntryRules.eventType,
    enabled: zoneEntryRules.enabled,
  };
  const ruleScope = (tenantId: string, cameraId: string) =>
    and(eq(zoneEntryRules.tenantId, tenantId), eq(zoneEntryRules.cameraId, cameraId));

  const historyFields = {
    id: replayZoneEntries.eventId,
    direction: replayZoneEntries.direction,
    cameraName: cameras.name,
    zoneName: sql<string>`${replayZoneEntries.zone}->>'name'`,
    ruleName: replayZoneEntries.ruleName,
    occurredAt: operationalEvents.occurredAt,
    passId: replayZoneEntries.passId,
    passNumber: replayZoneEntries.passNumber,
    sourceMs: replayZoneEntries.sourceMs,
  };
  const entryScope = (tenantId: string, cameraId: string) =>
    and(eq(replayZoneEntries.tenantId, tenantId), eq(replayZoneEntries.cameraId, cameraId));
  const entryEvent = and(
    eq(operationalEvents.tenantId, replayZoneEntries.tenantId),
    eq(operationalEvents.id, replayZoneEntries.eventId),
  );
  const entryCamera = and(eq(cameras.tenantId, replayZoneEntries.tenantId), eq(cameras.id, replayZoneEntries.cameraId));
  const entryObservation = and(
    eq(replayObservations.tenantId, replayZoneEntries.tenantId),
    eq(replayObservations.cameraId, replayZoneEntries.cameraId),
    eq(replayObservations.passId, replayZoneEntries.passId),
    eq(replayObservations.sourceMs, replayZoneEntries.sourceMs),
  );

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
    zoneEntryRules: {
      list(tenantId: string, cameraId: string) {
        return forTenant(tenantId, (tx) => tx.select(ruleFields).from(zoneEntryRules)
          .where(ruleScope(tenantId, cameraId)).orderBy(asc(zoneEntryRules.name), asc(zoneEntryRules.id)));
      },
      async add(tenantId: string, cameraId: string, input: RuleInput) {
        const [rule] = await forTenant(tenantId, async (tx) => {
          if (!await lockRuleZone(tx, tenantId, cameraId, input.zoneId)) return [];
          return tx.insert(zoneEntryRules).values({ ...input, tenantId, cameraId }).returning(ruleFields);
        });
        return rule;
      },
      async update(tenantId: string, cameraId: string, id: string, input: RuleInput) {
        const [rule] = await forTenant(tenantId, async (tx) => {
          if (!await lockRuleZone(tx, tenantId, cameraId, input.zoneId)) return [];
          return tx.update(zoneEntryRules).set({
            ...input,
            revision: sql`${zoneEntryRules.revision} + 1`,
          }).where(and(ruleScope(tenantId, cameraId), eq(zoneEntryRules.id, id))).returning(ruleFields);
        });
        return rule;
      },
      async remove(tenantId: string, cameraId: string, id: string) {
        const [rule] = await forTenant(tenantId, (tx) => tx.delete(zoneEntryRules)
          .where(and(ruleScope(tenantId, cameraId), eq(zoneEntryRules.id, id))).returning({ id: zoneEntryRules.id }));
        return Boolean(rule);
      },
      async setEnabled(tenantId: string, cameraId: string, id: string, enabled: boolean) {
        const [rule] = await forTenant(tenantId, (tx) => tx.update(zoneEntryRules).set({
          enabled,
          revision: sql`case when ${zoneEntryRules.enabled} <> ${enabled} then ${zoneEntryRules.revision} + 1 else ${zoneEntryRules.revision} end`,
        }).where(and(ruleScope(tenantId, cameraId), eq(zoneEntryRules.id, id))).returning(ruleFields));
        return rule;
      },
    },
    zoneEntries: {
      history(tenantId: string, cameraId: string) {
        return forTenant(tenantId, (tx) => tx.select(historyFields).from(replayZoneEntries)
          .innerJoin(operationalEvents, entryEvent).innerJoin(cameras, entryCamera)
          .where(entryScope(tenantId, cameraId))
          .orderBy(desc(operationalEvents.occurredAt), desc(replayZoneEntries.eventId)).limit(100));
      },
      async evidence(tenantId: string, cameraId: string, id: string) {
        const [row] = await forTenant(tenantId, (tx) => tx.select({
          ...historyFields,
          zone: replayZoneEntries.zone,
          person: sql<Observation['people'][number]>`${replayObservations.people}->${replayZoneEntries.personIndex}`,
          jpeg: replayObservations.eventJpeg,
        }).from(replayZoneEntries).innerJoin(operationalEvents, entryEvent).innerJoin(cameras, entryCamera)
          .innerJoin(replayObservations, entryObservation)
          .where(and(entryScope(tenantId, cameraId), eq(replayZoneEntries.eventId, id))));
        return row;
      },
    },
    observations: {
      recordForReplay(
        tenantId: string,
        frame: Observation & { passNumber: number; occurredAt: Date; jpeg: Buffer },
        evaluate: (rules: ActiveRule[]) => { rule: ActiveRule; personIndex: number; direction: (typeof replayZoneEntries.$inferSelect)['direction'] }[],
      ) {
        const { cameraId, passId, passNumber, sourceMs, people, occurredAt, jpeg } = frame;
        return forTenant(tenantId, async (tx) => {
          const rules = await tx.select({
            id: zoneEntryRules.id,
            zoneId: zoneEntryRules.zoneId,
            name: zoneEntryRules.name,
            minimumConfidence: zoneEntryRules.minimumConfidence,
            eventType: zoneEntryRules.eventType,
            revision: zoneEntryRules.revision,
            zoneName: cameraZones.name,
            points: cameraZones.points,
          }).from(zoneEntryRules).innerJoin(cameraZones, and(
            eq(cameraZones.tenantId, zoneEntryRules.tenantId),
            eq(cameraZones.cameraId, zoneEntryRules.cameraId),
            eq(cameraZones.id, zoneEntryRules.zoneId),
          )).where(and(ruleScope(tenantId, cameraId), eq(zoneEntryRules.enabled, true)))
            .for('share', { of: zoneEntryRules });

          const crossings = evaluate(rules);
          const [saved] = await tx.insert(replayObservations).values({
            tenantId, cameraId, passId, sourceMs, people,
            eventJpeg: crossings.length ? jpeg.toString('base64') : null,
          }).onConflictDoNothing().returning({ sourceMs: replayObservations.sourceMs });
          if (!saved || !crossings.length) return;

          const evidence = crossings.map(({ rule, personIndex, direction }) => ({
            eventId: randomUUID(), tenantId, cameraId, passId, passNumber, sourceMs,
            ruleId: rule.id, ruleName: rule.name, personIndex, direction,
            zone: { id: rule.zoneId, name: rule.zoneName, points: rule.points },
          }));
          await tx.insert(operationalEvents).values(evidence.map(({ eventId }) => ({ id: eventId, tenantId, occurredAt })));
          await tx.insert(replayZoneEntries).values(evidence);
        });
      },
      list(tenantId: string, { cameraId, passId, fromMs, toMs }: {
        cameraId: string; passId: string; fromMs: number; toMs: number;
      }) {
        return forTenant(tenantId, (tx) => tx.select({
          cameraId: replayObservations.cameraId, passId: replayObservations.passId,
          sourceMs: replayObservations.sourceMs, people: replayObservations.people,
        }).from(replayObservations).where(and(
          eq(replayObservations.tenantId, tenantId), eq(replayObservations.cameraId, cameraId),
          eq(replayObservations.passId, passId),
          gte(replayObservations.sourceMs, fromMs), lt(replayObservations.sourceMs, toMs),
        )).orderBy(asc(replayObservations.sourceMs)));
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
