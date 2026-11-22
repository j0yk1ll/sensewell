# Sensewell

## Run locally

Install Docker with the Compose v2 plugin and start the stack with:

```sh
docker compose up --build
```

Open [localhost:3000](http://localhost:3000). The header should say “The API is connected to PostgreSQL.” You can also check the API directly:

```sh
curl --fail http://localhost:3000/api/health
# {"status":"ready"}
```

Compose starts PostgreSQL, applies the Drizzle migrations, and starts the app. PostgreSQL data and IP camera recordings persist in the `postgres-data` and `camera-recordings` volumes. Use `docker compose down` to stop the stack.

The Compose secret and origins are for local use. Set `BETTER_AUTH_SECRET` to a random secret (at least 32 characters) and `BETTER_AUTH_URL` to the browser-facing HTTPS URL for a deployment.

On upgrade, legacy clip cameras are hidden from the workspace. Existing database evidence and uploaded clip files stay in storage, including any existing `camera-clips` volume.

## Connect and record an IP camera

The optional [warehouse simulator](docs/warehouse-demo.md#run-the-warehouse-as-ip-cameras) provides three local RTSP feeds for this workflow.

1. Sign in. A camera endpoint administrator can open **Camera endpoints** and approve a hostname, IP address, or RTSP URL. Approvals are saved by host and port, with 554 as the default. For the public Sarine Valley webcam, paste `rtsp://rtsp.143b.ch:554/stream`.
2. Under **Add a camera**, enter a name, the `rtsp://` stream URL, and any credentials in the separate fields. Choose **Connect IP camera**.
3. Capture starts automatically. When the feed is interrupted the workspace reports it as unavailable and retries in the background. Capture also resumes after an app restart. Keep `BETTER_AUTH_SECRET` stable across restarts so saved camera settings can be decrypted.
4. Open a time range in **Recorded footage**. Completed MP4 segments become playable as they are recorded. The timeline shows outages between segments as **Footage unavailable**, and playback stops at a gap.
5. Choose **Remove camera** and confirm to stop capture and remove the camera from the workspace.

To give an existing account access to the endpoint settings, run this once from the Compose project and reload the workspace:

```sh
docker compose run --rm migrate node node_modules/@sensewell/database/dist/grant-camera-endpoint-admin.js you@example.com
```

Outside Compose, run the compiled `packages/database/dist/grant-camera-endpoint-admin.js` with `DATABASE_MIGRATION_URL` set. The approval list applies to all camera workspaces. Revoking an endpoint stops active capture from it. Existing footage stays playable, and capture resumes if the endpoint is approved again. Deployments upgrading from `IP_CAMERA_ENDPOINTS` import that list on the first migration run. Subsequent changes are managed in the UI.

Approve only endpoints you trust. The list checks the submitted address. FFmpeg can follow redirects from an approved server, so network-level restrictions on redirect destinations are enforced by the deployment.

The initial input is RTSP over TCP. The app records video as browser-playable H.264 using the existing FFmpeg runtime. For a local run outside Compose, set `RECORDING_STORAGE_DIR` to choose a private storage directory. The default is `.sensewell-recordings` in the API working directory.

## Work on the apps

Use Node.js 24 and the pnpm version in `package.json`. Run `corepack enable` to activate that version and `pnpm install --frozen-lockfile` to install workspace dependencies. `pnpm lint`, `pnpm typecheck`, and `pnpm build` run from the repository root.

Install `ffmpeg` and `ffprobe` on your PATH. With a migrated PostgreSQL instance, set `DATABASE_URL` for the `sensewell_app` role, set `BETTER_AUTH_SECRET` to a local secret of at least 32 characters, and set `BETTER_AUTH_URL=http://localhost:5173`. Run `pnpm dev` to start both apps. Vite serves the web app on port 5173 and proxies API requests to NestJS on port 3000. To run either app on its own, run `pnpm build` once to build the shared packages, then run `pnpm --filter @sensewell/web dev` or `pnpm --filter @sensewell/api dev`. The web app expects an API on port 3000 for the status check.

The web workspace uses React, Vite, Tailwind CSS, shadcn/ui, TanStack Router, TanStack Query, and shared Zod response contracts. Shared UI components live in `apps/web/src/components/ui` and use the theme in `apps/web/src/styles.css`. Better Auth handles operator accounts and sessions.

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

The tests apply the checked-in migrations and verify tenant isolation for events and camera zones under the application login. They also verify that a saved zone is returned only for its camera. Stop the disposable database with `docker stop sensewell-test-db`.

GitHub Actions runs lint, type checking, and the PostgreSQL integration test on every push. It also builds and starts the Compose stack and checks the page and health endpoint.
