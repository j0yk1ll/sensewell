import { sql } from 'drizzle-orm';
import { pgPolicy, pgRole, pgTable, timestamp, uuid } from 'drizzle-orm/pg-core';

const applicationRole = pgRole('sensewell_app').existing();

export const operationalEvents = pgTable(
  'operational_events',
  {
    id: uuid().primaryKey(),
    tenantId: uuid('tenant_id').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
  },
  (event) => {
    const belongsToTenant = sql`${event.tenantId} = nullif(current_setting('sensewell.tenant_id', true), '')::uuid`;

    return [
      pgPolicy('tenant_isolation', {
        for: 'all',
        to: applicationRole,
        using: belongsToTenant,
        withCheck: belongsToTenant,
      }),
    ];
  },
).enableRLS();
