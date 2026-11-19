import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, escapeLiteral } from 'pg';
import { requireEnv } from './require-env.js';

export async function migrateDatabase() {
  const password = escapeLiteral(requireEnv('DATABASE_APP_PASSWORD'));
  const client = new Client({ connectionString: requireEnv('DATABASE_MIGRATION_URL') });
  await client.connect();

  try {
    // Serialize role provisioning and migrations across sessions. Closing the client releases the lock.
    await client.query("select pg_advisory_lock(hashtext('sensewell:migrations'))");
    await client.query(`
      do $$
      begin
        if not exists (select from pg_roles where rolname = 'sensewell_app') then
          create role sensewell_app;
        end if;
      end
      $$;
    `);
    await client.query(`
      alter role sensewell_app with login nosuperuser nocreatedb nocreaterole
        noreplication nobypassrls password ${password}
    `);

    await migrate(drizzle(client), {
      migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
    });
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  await migrateDatabase();
}
