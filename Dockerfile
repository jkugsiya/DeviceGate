# DeviceGate container image. TeamClaude stays on the host (it holds your Claude login), so run
# this with host networking; see docker-compose.yml and the README.

FROM node:22-bookworm-slim AS build
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM node:22-bookworm-slim
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    DATABASE_PATH=/app/data/gateway.db
# Full install (not standalone output) so the admin and device CLIs run inside the container.
COPY --from=build --chown=node:node /app ./
RUN mkdir -p /app/data && chown node:node /app/data
USER node
VOLUME /app/data
EXPOSE 3000
CMD ["bun", "run", "start"]
