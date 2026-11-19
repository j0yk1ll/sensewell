import { sql } from 'drizzle-orm';
import { boolean, foreignKey, index, integer, pgPolicy, pgRole, pgTable, text, timestamp, unique, uuid, type AnyPgColumn } from 'drizzle-orm/pg-core';

const applicationRole = pgRole('sensewell_app').existing();

export const operationalEvents = pgTable(
  'operational_events',
  {
    id: uuid().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (event) => [tenantIsolation(event.tenantId)],
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

export const syntheticCameras = pgTable('synthetic_cameras', {
  id: uuid().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  name: text().notNull(),
  durationMs: integer('duration_ms').notNull(),
  startOffsetMs: integer('start_offset_ms').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (camera) => [
  tenantIsolation(camera.tenantId),
  unique().on(camera.tenantId, camera.id),
]).enableRLS();

export const replayPasses = pgTable('replay_passes', {
  id: uuid().primaryKey(),
  tenantId: uuid('tenant_id').notNull(),
  cameraId: uuid('camera_id').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
}, (pass) => [
  tenantIsolation(pass.tenantId),
  foreignKey({
    columns: [pass.tenantId, pass.cameraId],
    foreignColumns: [syntheticCameras.tenantId, syntheticCameras.id],
  }),
  index().on(pass.tenantId, pass.cameraId),
]).enableRLS();
