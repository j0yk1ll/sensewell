FROM docker.io/library/node:24-alpine AS build
WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/database/package.json packages/database/package.json
RUN corepack enable && pnpm install --frozen-lockfile

COPY apps ./apps
COPY packages ./packages
RUN pnpm build && pnpm --filter @sensewell/api deploy --legacy --prod /runtime

FROM docker.io/library/node:24-alpine
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 STATIC_ROOT=/app/web
RUN apk add --no-cache ffmpeg && mkdir /app/clips && chown node:node /app/clips
COPY --from=build /runtime ./
COPY --from=build /workspace/apps/web/dist ./web
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]
