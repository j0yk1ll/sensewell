import { sql } from 'drizzle-orm';
import { boolean, check, doublePrecision, foreignKey, index, integer, jsonb, pgPolicy, pgRole, pgTable, primaryKey, text, timestamp, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

const applicationRole = pgRole('sensewell_app').existing();

export const operationalEvents = pgTable(
  'operational_events',
  {
    id: uuid().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (event) => [tenantIsolation(event.tenantId), unique().on(event.tenantId, event.id)],
).enableRLS();

function tenantIsolation(tenantId: AnyPgColumn) {
  const belongsToTenant = sql`${tenantId} = nullif(current_setting('sensewell.tenant_id', true), '')::uuid`;
  return pgPolicy('tenant_isolation', {
    for: 'all',
    to: applicationRole,
    using: belongsToTenant,
    withCheck: belongsToTenant,
  });
}

export const authUser = pgTable('user', {
  id: uuid().defaultRandom().primaryKey(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: boolean().default(false).notNull(),
  image: text(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
});

export const authSession = pgTable('session', {
  id: uuid().defaultRandom().primaryKey(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  token: text().notNull().unique(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull(),
  ipAddress: text(),
  userAgent: text(),
  userId: uuid().notNull().references(() => authUser.id, { onDelete: 'cascade' }),
}, (session) => [index().on(session.userId)]);

export const authAccount = pgTable('account', {
  id: uuid().defaultRandom().primaryKey(),
  accountId: text().notNull(),
  providerId: text().notNull(),
  userId: uuid().notNull().references(() => authUser.id, { onDelete: 'cascade' }),
  accessToken: text(),
  refreshToken: text(),
  idToken: text(),
  accessTokenExpiresAt: timestamp({ withTimezone: true }),
  refreshTokenExpiresAt: timestamp({ withTimezone: true }),
  scope: text(),
  password: text(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).notNull(),
}, (account) => [index().on(account.userId)]);

export const authVerification = pgTable('verification', {
  id: uuid().defaultRandom().primaryKey(),
  identifier: text().notNull(),
  value: text().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp({ withTimezone: true }).defaultNow().notNull(),
}, (verification) => [index().on(verification.identifier)]);

export const cameras = pgTable('cameras', {
  id: uuid().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text().notNull(),
  durationMs: integer('duration_ms'),
  startOffsetMs: integer('start_offset_ms'),
  encryptedStream: text('encrypted_stream'),
  removedAt: timestamp('removed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (camera) => [
  tenantIsolation(camera.tenantId),
  pgPolicy('ip_camera_removal', {
    as: 'restrictive', for: 'update', to: applicationRole,
    using: sql`${camera.encryptedStream} is not null`,
    withCheck: sql`${camera.removedAt} is not null and ${camera.encryptedStream} is null`,
  }),
  unique('synthetic_cameras_tenant_id_id_unique').on(camera.tenantId, camera.id),
  check('camera_source', sql`
    (${camera.encryptedStream} is null and ${camera.removedAt} is null
      and ${camera.durationMs} is not null and ${camera.startOffsetMs} is not null)
    or ((${camera.encryptedStream} is not null) <> (${camera.removedAt} is not null)
      and ${camera.durationMs} is null and ${camera.startOffsetMs} is null)
  `),
]).enableRLS();

export const cameraZones = pgTable('camera_zones', {
  id: uuid().defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  cameraId: uuid('camera_id').notNull(),
  name: text().notNull(),
  points: jsonb().$type<{ x: number; y: number }[]>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (zone) => [
  tenantIsolation(zone.tenantId),
  foreignKey({
    name: 'camera_zones_camera_fk',
    columns: [zone.tenantId, zone.cameraId],
    foreignColumns: [cameras.tenantId, cameras.id],
  }).onDelete('cascade'),
  unique().on(zone.tenantId, zone.cameraId, zone.id),
]).enableRLS();

export const replayPasses = pgTable('replay_passes', {
  id: uuid().primaryKey(),
  runId: uuid('run_id').defaultRandom().notNull(),
  tenantId: uuid('tenant_id').notNull(),
  cameraId: uuid('camera_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
}, (pass) => [
  tenantIsolation(pass.tenantId),
  foreignKey({
    name: 'replay_passes_tenant_id_camera_id_synthetic_cameras_tenant_id_id_fk',
    columns: [pass.tenantId, pass.cameraId],
    foreignColumns: [cameras.tenantId, cameras.id],
  }),
  unique().on(pass.tenantId, pass.cameraId, pass.id),
  index().on(pass.tenantId, pass.cameraId, pass.startedAt, pass.id),
  index().on(pass.tenantId, pass.cameraId, pass.runId),
]).enableRLS();

export const replayObservations = pgTable('replay_observations', {
  tenantId: uuid('tenant_id').notNull(),
  cameraId: uuid('camera_id').notNull(),
  passId: uuid('pass_id').notNull(),
  sourceMs: integer('source_ms').notNull(),
  eventJpeg: text('event_jpeg'),
  detections: jsonb('people').$type<{ box: [number, number, number, number]; confidence: number; objectType?: string }[]>().notNull(),
}, (frame) => [
  tenantIsolation(frame.tenantId),
  primaryKey({ columns: [frame.tenantId, frame.cameraId, frame.passId, frame.sourceMs] }),
  foreignKey({
    name: 'replay_observations_pass_fk',
    columns: [frame.tenantId, frame.cameraId, frame.passId],
    foreignColumns: [replayPasses.tenantId, replayPasses.cameraId, replayPasses.id],
  }),
  check('replay_observation_source_ms', sql`${frame.sourceMs} >= 0`),
]).enableRLS();

export const cameraRecordings = pgTable('camera_recordings', {
  id: uuid().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  cameraId: uuid('camera_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  endedAt: timestamp('ended_at', { withTimezone: true }).notNull(),
}, (recording) => [
  tenantIsolation(recording.tenantId),
  foreignKey({
    name: 'camera_recordings_camera_fk',
    columns: [recording.tenantId, recording.cameraId],
    foreignColumns: [cameras.tenantId, cameras.id],
  }).onDelete('cascade'),
  index().on(recording.tenantId, recording.cameraId, recording.startedAt),
]).enableRLS();

export const cameraEndpointAdministrators = pgTable('camera_endpoint_administrators', {
  userId: uuid('user_id').primaryKey().references(() => authUser.id, { onDelete: 'cascade' }),
});

const managesCameraEndpoints = sql`exists (
  select from ${cameraEndpointAdministrators}
  where user_id = nullif(current_setting('sensewell.tenant_id', true), '')::uuid
)`;

export const cameraEndpoints = pgTable('camera_endpoints', {
  endpoint: text().primaryKey(),
}, () => [
  pgPolicy('camera_endpoint_read', { for: 'select', to: applicationRole, using: sql`true` }),
  pgPolicy('camera_endpoint_add', { for: 'insert', to: applicationRole, withCheck: managesCameraEndpoints }),
  pgPolicy('camera_endpoint_remove', { for: 'delete', to: applicationRole, using: managesCameraEndpoints }),
]).enableRLS();

export const cameraEndpointImport = pgTable('camera_endpoint_import', {
  id: integer().primaryKey(),
}, (state) => [check('camera_endpoint_import_singleton', sql`${state.id} = 1`)]);

export const zoneEntryRules = pgTable('zone_entry_rules', {
  id: uuid().defaultRandom().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  cameraId: uuid('camera_id').notNull(),
  zoneId: uuid('zone_id').notNull(),
  name: text().notNull(),
  minimumConfidence: doublePrecision('minimum_confidence').notNull(),
  eventType: text('event_type', { enum: ['entry', 'exit', 'both'] }).default('both').notNull(),
  objectTypes: text('object_types').array().default(sql`ARRAY['person']::text[]`).notNull(),
  enabled: boolean().default(false).notNull(),
  revision: integer().default(0).notNull(),
}, (rule) => [
  tenantIsolation(rule.tenantId),
  foreignKey({
    name: 'zone_entry_rules_zone_fk',
    columns: [rule.tenantId, rule.cameraId, rule.zoneId],
    foreignColumns: [cameraZones.tenantId, cameraZones.cameraId, cameraZones.id],
  }).onDelete('cascade'),
  index().on(rule.tenantId, rule.cameraId, rule.zoneId),
  check('zone_entry_rule_objects', sql`cardinality(${rule.objectTypes}) > 0`),
  check('zone_entry_rule_event_type', sql`${rule.eventType} in ('entry', 'exit', 'both')`),
  check('zone_entry_rule_confidence', sql`${rule.minimumConfidence} between 0 and 1`),
]).enableRLS();

export const replayZoneEntries = pgTable('replay_zone_entries', {
  eventId: uuid('event_id').primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  cameraId: uuid('camera_id').notNull(),
  passId: uuid('pass_id').notNull(),
  passNumber: integer('pass_number').notNull(),
  sourceMs: integer('source_ms').notNull(),
  ruleId: uuid('rule_id').notNull(),
  ruleName: text('rule_name').notNull(),
  direction: text({ enum: ['entry', 'exit'] }).default('entry').notNull(),
  zone: jsonb().$type<{ id: string; name: string; points: (typeof cameraZones.$inferSelect)['points'] }>().notNull(),
  detectionIndex: integer('person_index').notNull(),
  objectType: text('object_type').default('person').notNull(),
}, (entry) => [
  tenantIsolation(entry.tenantId),
  check('replay_zone_entry_direction', sql`${entry.direction} in ('entry', 'exit')`),
  foreignKey({
    name: 'replay_zone_entries_event_fk',
    columns: [entry.tenantId, entry.eventId],
    foreignColumns: [operationalEvents.tenantId, operationalEvents.id],
  }),
  foreignKey({
    name: 'replay_zone_entries_observation_fk',
    columns: [entry.tenantId, entry.cameraId, entry.passId, entry.sourceMs],
    foreignColumns: [replayObservations.tenantId, replayObservations.cameraId, replayObservations.passId, replayObservations.sourceMs],
  }),
  index().on(entry.tenantId, entry.cameraId),
]).enableRLS();
