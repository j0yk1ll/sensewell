# Sensewell

## Run locally

Install Docker with the Compose v2 plugin. From a fresh checkout, run:

```sh
docker compose up --build
```

Open [localhost:3000](http://localhost:3000). The header should say “The API is connected to PostgreSQL.” You can also check the API directly:

```sh
curl --fail http://localhost:3000/api/health
# {"status":"ready"}
```

Compose starts PostgreSQL, applies the Drizzle migrations, then starts the app. The migration job exits successfully after applying pending migrations. PostgreSQL data and uploaded clips persist in the `postgres-data` and `camera-clips` volumes. Use `docker compose down` to stop the stack. Add any new runtime dependencies to `compose.yaml` as part of the slice that introduces them.

## Add and replay a Synthetic Camera

1. Create an operator account and sign in. Each account has its own camera workspace.
2. Enter a camera name and upload an H.264 MP4 clip up to 512 MiB. Select the camera to reopen its playable source preview.
3. Select **Loop replay** if needed, then choose **Start replay**. The replay display marks the simulated shift and shows the source position and pass number. **Stop replay** returns to the source preview.

FFmpeg decodes up to 10 replay frames per second at 1× source speed. Each pass has a persistent ID tied to the source camera. Active playback runs in the app process and stops when that process exits.

The Compose secret and origins are for local use. Set `BETTER_AUTH_SECRET` to a random secret (at least 32 characters) and `BETTER_AUTH_URL` to the browser-facing HTTPS URL for a deployment.

## Work on the apps

Use Node.js 24 and the pnpm version in `package.json`. Run `corepack enable` to activate that version and `pnpm install --frozen-lockfile` to install workspace dependencies. `pnpm lint`, `pnpm typecheck`, and `pnpm build` run from the repository root.

Install `ffmpeg` and `ffprobe` on your PATH. With a migrated PostgreSQL instance, set `DATABASE_URL` for the `sensewell_app` role, set `BETTER_AUTH_SECRET` to a local secret of at least 32 characters, and set `BETTER_AUTH_URL=http://localhost:5173`. Run `pnpm dev` to start both apps. Set `CLIP_STORAGE_DIR` to choose a private clip directory. By default the API stores clips in `.sensewell-clips` in its working directory. Vite serves the web app on port 5173 and proxies API requests to NestJS on port 3000. To run either app on its own, run `pnpm build` once to build the shared packages, then run `pnpm --filter @sensewell/web dev` or `pnpm --filter @sensewell/api dev`. The web app expects an API on port 3000 for the status check.

The web workspace uses React, Vite, Tailwind CSS, TanStack Router, TanStack Query, and shared Zod response contracts. Better Auth handles operator accounts and sessions.

To apply migrations outside Compose, build the workspace, then run `pnpm --filter @sensewell/database db:migrate` with `DATABASE_MIGRATION_URL` and `DATABASE_APP_PASSWORD` set. Use the latter password in the runtime `DATABASE_URL` for the `sensewell_app` login. When changing the schema, run `pnpm --filter @sensewell/database db:generate --name <migration-name>` and commit the SQL and metadata.

## Run the PostgreSQL integration test

Start a disposable PostgreSQL instance:

```sh
docker run --rm --detach --name sensewell-test-db \
  --publish 127.0.0.1:5433:5432 \
  --env POSTGRES_DB=sensewell_test \
  --env POSTGRES_USER=sensewell_admin \
  --env POSTGRES_PASSWORD=test-admin \
  postgres:17-alpine
```

Once PostgreSQL is accepting connections, run:

```sh
DATABASE_MIGRATION_URL=postgresql://sensewell_admin:test-admin@127.0.0.1:5433/sensewell_test \
DATABASE_URL=postgresql://sensewell_app:test-app@127.0.0.1:5433/sensewell_test \
DATABASE_APP_PASSWORD=test-app \
pnpm test
```

The test applies the checked-in migrations and uses the application login to insert a tenant-owned event. It verifies that PostgreSQL returns the event to its owner, hides it from another tenant, and rejects a cross-tenant insert. Stop the disposable database with `docker stop sensewell-test-db`.

GitHub Actions runs lint, type checking, and the PostgreSQL integration test on every push. It also builds and starts the Compose stack and checks the page and health endpoint.
