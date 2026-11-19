import { Client } from 'pg';
import { requireEnv } from './require-env.js';

const email = process.argv[2]?.trim().toLowerCase();
if (!email || process.argv.length !== 3) {
  console.error('Provide the email of an existing Sensewell account.');
  process.exit(1);
}

const client = new Client({ connectionString: requireEnv('DATABASE_MIGRATION_URL') });
await client.connect();
try {
  const result = await client.query<{ id: string }>('select id from "user" where email = $1', [email]);
  const [operator] = result.rows;
  if (!operator) {
    console.error('No Sensewell account matches that email.');
    process.exitCode = 1;
  } else {
    await client.query('insert into camera_endpoint_administrators (user_id) values ($1) on conflict do nothing', [operator.id]);
    console.log('The account can now manage camera endpoints.');
  }
} finally {
  await client.end();
}
