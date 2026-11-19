import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { requireEnv } from './require-env.js';
import { operationalEvents } from './schema.js';

export { operationalEvents } from './schema.js';

type TenantTransaction = Parameters<Parameters<ReturnType<typeof drizzle>['transaction']>[0]>[0];

export function createDatabase({ max }: { max?: number } = {}) {
  const pool = new Pool({
    connectionString: requireEnv('DATABASE_URL'),
    connectionTimeoutMillis: 3000,
    max,
  });
  pool.on('error', (error) => console.warn('Idle PostgreSQL connection failed:', error.message));
  const database = drizzle(pool);

  return {
    async checkReadiness() {
      await database.execute(sql`select 1 from ${operationalEvents} where false`);
    },
    // The caller supplies the authorized tenant. PostgreSQL limits the setting to this transaction.
    forTenant<T>(tenantId: string, query: (tx: TenantTransaction) => Promise<T>) {
      return database.transaction(async (tx) => {
        await tx.execute(sql`select set_config('sensewell.tenant_id', ${tenantId}, true)`);
        return query(tx);
      });
    },
    close() {
      return pool.end();
    },
  };
}
