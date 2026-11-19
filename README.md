# Sensewell

## Run locally

Install Docker with the Compose v2 plugin. From a fresh checkout, run:

```sh
docker compose up --build
```

Open [localhost:3000](http://localhost:3000). The status page should say “The API is connected to PostgreSQL.” You can also check the API directly:

```sh
curl --fail http://localhost:3000/api/health
# {"status":"ready"}
```

Compose starts PostgreSQL, applies the Drizzle migrations, then starts the app. The migration job exits successfully after applying pending migrations. PostgreSQL data persists in the `postgres-data` volume. Use `docker compose down` to stop the stack. Add any new runtime dependencies to `compose.yaml` as part of the slice that introduces them.

## Work on the apps

Use Node.js 24 and the pnpm version in `package.json`. Run `corepack enable` to activate that version and `pnpm install --frozen-lockfile` to install workspace dependencies. `pnpm lint`, `pnpm typecheck`, and `pnpm build` run from the repository root.

With a migrated PostgreSQL instance and `DATABASE_URL` set for the `sensewell_app` role, run `pnpm dev` to start both apps. Vite serves the web app on port 5173 and proxies API requests to NestJS on port 3000. To run either app on its own, run `pnpm build` once to build the shared packages, then run `pnpm --filter @sensewell/web dev` or `pnpm --filter @sensewell/api dev`. The web app expects an API on port 3000 for the status check.

The status page uses React, Vite, Tailwind CSS, TanStack Router, TanStack Query, and a shared Zod response contract. The MVP adds shadcn/ui with shared UI components, Better Auth with authentication and sessions, and react-konva with zone editing.

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
