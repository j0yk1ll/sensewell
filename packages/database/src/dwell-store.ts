import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import type { DwellCandidate, DwellRecording, ForkliftDwellCondition, PublishedDwell, RecordingObservation, TriggerRange } from '@sensewell/contracts';
import { confirmationGapMs, forkliftDwellLookbackMs, forkliftDwellMs } from '@sensewell/contracts';
import type { TenantTransaction, ForTenant } from './index.js';
import { recordingFields, recordingScope } from './recording-store.js';
import { cameraRecordings, cameras, dwellTriggerEvents, dwellTriggers, operationalEvents } from './schema.js';

const triggerFields = {
  id: dwellTriggers.id, condition: dwellTriggers.condition, reviewed: dwellTriggers.reviewed, activeSince: dwellTriggers.activeSince,
};
type RecordedSegment = Record<'startedAt' | 'endedAt', Date> & { id: string };
type ActiveTrigger = Pick<typeof dwellTriggers.$inferSelect, 'condition' | 'cameraId'> & { activeSince: Date };

const triggerScope = (tenantId: string, cameraId: string) =>
  and(eq(dwellTriggers.tenantId, tenantId), eq(dwellTriggers.cameraId, cameraId));

async function loadRecordings(tx: TenantTransaction, tenantId: string, cameraIds: string[], range: TriggerRange): Promise<DwellRecording[]> {
  const recordings = await tx.select({ ...recordingFields, cameraId: cameraRecordings.cameraId, observations: cameraRecordings.observations })
    .from(cameraRecordings).innerJoin(cameras, and(
      eq(cameras.tenantId, cameraRecordings.tenantId), eq(cameras.id, cameraRecordings.cameraId),
    )).where(and(
      eq(cameraRecordings.tenantId, tenantId), inArray(cameraRecordings.cameraId, cameraIds), isNull(cameras.removedAt), isNotNull(cameraRecordings.observations),
      lte(cameraRecordings.startedAt, new Date(range.endMs)), gt(cameraRecordings.endedAt, new Date(range.startMs)),
    )).orderBy(asc(cameraRecordings.startedAt), asc(cameraRecordings.id));
  return recordings.map(({ id, cameraId, startedAt, endedAt, observations }) => ({
    id, cameraId, startMs: startedAt.getTime(), endMs: endedAt.getTime(), frames: observations ?? [],
  }));
}

export function createDwellStore(forTenant: ForTenant) {
  return {
    list(tenantId: string, cameraId: string) {
      return forTenant(tenantId, (tx) => tx.select(triggerFields)
        .from(dwellTriggers).where(triggerScope(tenantId, cameraId)).orderBy(asc(dwellTriggers.id)));
    },
    async find(tenantId: string, cameraId: string, id: string) {
      const [trigger] = await forTenant(tenantId, (tx) => tx.select(triggerFields)
        .from(dwellTriggers).where(and(triggerScope(tenantId, cameraId), eq(dwellTriggers.id, id))));
      return trigger;
    },
    async draft(tenantId: string, cameraId: string, condition: ForkliftDwellCondition) {
      return forTenant(tenantId, async (tx) => {
        const [trigger] = await tx.insert(dwellTriggers).values({ tenantId, cameraId, condition }).returning(triggerFields);
        if (!trigger) throw new Error('Trigger insert returned no row.');
        return trigger;
      });
    },
    async setEnabled(tenantId: string, cameraId: string, id: string, enabled: boolean) {
      const [trigger] = await forTenant(tenantId, (tx) => tx.update(dwellTriggers).set({
        ...(enabled ? { reviewed: true } : {}),
        activeSince: enabled ? sql`coalesce(${dwellTriggers.activeSince}, clock_timestamp())` : null,
      }).where(and(triggerScope(tenantId, cameraId), eq(dwellTriggers.id, id))).returning(triggerFields));
      return trigger;
    },
    history(tenantId: string, cameraId: string) {
      return forTenant(tenantId, (tx) => tx.select({
        id: dwellTriggerEvents.id, condition: dwellTriggerEvents.condition, match: dwellTriggerEvents.match,
      }).from(dwellTriggerEvents).where(and(eq(dwellTriggerEvents.tenantId, tenantId), eq(dwellTriggerEvents.cameraId, cameraId)))
        .orderBy(desc(dwellTriggerEvents.occurredAt), desc(dwellTriggerEvents.id)).limit(100));
    },
    async eventEvidence(tenantId: string, cameraId: string, eventId: string, recordingId: string) {
      const [event] = await forTenant(tenantId, (tx) => tx.select({ match: dwellTriggerEvents.match })
        .from(dwellTriggerEvents).where(and(
          eq(dwellTriggerEvents.tenantId, tenantId), eq(dwellTriggerEvents.cameraId, cameraId), eq(dwellTriggerEvents.id, eventId),
        )));
      if (!event) return undefined;
      const clip = [...event.match.evidence, ...(event.match.supportingEvidence ?? [])]
        .find((evidence) => evidence.recordingId === recordingId);
      if (!clip) return undefined;
      const evidenceCamera = clip.cameraId ?? cameraId;
      const [recording] = await forTenant(tenantId, (tx) => tx.select({ id: cameraRecordings.id }).from(cameraRecordings)
        .where(and(recordingScope(tenantId, evidenceCamera), eq(cameraRecordings.id, recordingId))));
      return recording && { cameraId: evidenceCamera, recordingId };
    },
    recordings(tenantId: string, cameraId: string, range: TriggerRange, condition?: ForkliftDwellCondition) {
      const cameraIds = [cameraId, ...(condition?.supportingViews?.map((view) => view.cameraId) ?? [])];
      return forTenant(tenantId, (tx) => loadRecordings(tx, tenantId, cameraIds, range));
    },
    async nextRecording(tenantId: string, cameraId: string) {
      const [recording] = await forTenant(tenantId, (tx) => tx.select(recordingFields)
        .from(cameraRecordings).where(and(recordingScope(tenantId, cameraId), isNull(cameraRecordings.observations)))
        .orderBy(asc(cameraRecordings.startedAt), asc(cameraRecordings.id)).limit(1));
      return recording;
    },
    publish(
      tenantId: string, cameraId: string, segment: RecordedSegment, observations: RecordingObservation[],
      evaluate: (
        trigger: ActiveTrigger, recordings: DwellRecording[], range: TriggerRange, published: PublishedDwell[],
      ) => DwellCandidate[],
    ) {
      return forTenant(tenantId, async (tx) => {
        // Serialize publications for overlapping segments, including writers in different processes.
        await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${tenantId}, 0))`);
        const [saved] = await tx.update(cameraRecordings).set({ observations }).where(and(
          recordingScope(tenantId, cameraId), eq(cameraRecordings.id, segment.id), isNull(cameraRecordings.observations),
        )).returning({ id: cameraRecordings.id });
        if (!saved || !observations.some(({ detections }) => detections)) return;
        const startMs = segment.startedAt.getTime();
        const endMs = segment.endedAt.getTime();
        const triggers = await tx.select({ ...triggerFields, cameraId: dwellTriggers.cameraId }).from(dwellTriggers)
          .innerJoin(cameras, and(eq(cameras.tenantId, dwellTriggers.tenantId), eq(cameras.id, dwellTriggers.cameraId)))
          .where(and(
            eq(dwellTriggers.tenantId, tenantId), isNull(cameras.removedAt), lte(dwellTriggers.activeSince, segment.endedAt),
            or(eq(dwellTriggers.cameraId, cameraId),
              sql`(${dwellTriggers.condition}->'supportingViews') @> ${JSON.stringify([{ cameraId }])}::jsonb`),
          )).orderBy(asc(dwellTriggers.id)).for('update', { of: dwellTriggers });
        if (!triggers.length) return;
        // Only matches whose proof could use the new segment are candidates.
        const range = { startMs: Math.max(0, startMs - forkliftDwellLookbackMs), endMs: endMs + forkliftDwellMs + confirmationGapMs };
        const cameraIds = [...new Set(triggers.flatMap((trigger) =>
          [trigger.cameraId, ...(trigger.condition.supportingViews?.map((view) => view.cameraId) ?? [])]))];
        const recordings = await loadRecordings(tx, tenantId, cameraIds, range);
        for (const trigger of triggers) {
          if (!trigger.activeSince) continue;
          const previous = await tx.select({ key: dwellTriggerEvents.occurrenceKey, match: dwellTriggerEvents.match })
            .from(dwellTriggerEvents).where(and(
              eq(dwellTriggerEvents.triggerId, trigger.id),
              gte(dwellTriggerEvents.occurredAt, new Date(Math.max(range.startMs, trigger.activeSince.getTime()) + forkliftDwellMs)),
              lte(dwellTriggerEvents.occurredAt, new Date(range.endMs)),
            ));
          const previousKeys = new Set(previous.map(({ key }) => key));
          const matches = evaluate({ ...trigger, activeSince: trigger.activeSince }, recordings, range, previous.map(({ match }) => match));
          for (const { occurrenceKey, ...match } of matches) {
            // Overlap can establish a match after the threshold footage was already published.
            if (match.entryMs >= endMs) continue;
            if (previousKeys.has(occurrenceKey)) continue;
            const id = randomUUID();
            const occurredAt = new Date(match.occurrenceMs);
            await tx.insert(operationalEvents).values({ id, tenantId, occurredAt });
            await tx.insert(dwellTriggerEvents).values({
              id, tenantId, cameraId: trigger.cameraId, triggerId: trigger.id, occurrenceKey, occurredAt, match, condition: trigger.condition,
            });
          }
        }
      });
    },
  };
}
