import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, escapeLiteral } from 'pg';
import { normalizeCameraEndpoint } from './camera-endpoint.js';
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

    const endpoints = (process.env.IP_CAMERA_ENDPOINTS ?? '').split(',')
      .map(normalizeCameraEndpoint).filter((endpoint) => endpoint !== undefined);
    // Claim the import and apply it together so UI removals survive every subsequent migration run.
    await client.query(`
      with initial_import as (
        insert into camera_endpoint_import (id) values (1)
        on conflict do nothing returning id
      )
      insert into camera_endpoints (endpoint)
      select endpoint from initial_import, unnest($1::text[]) as imported(endpoint)
      on conflict do nothing
    `, [endpoints]);
  } finally {
    await client.end();
  }
}

if (import.meta.main) {
  await migrateDatabase();
}
