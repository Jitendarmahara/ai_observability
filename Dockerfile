# Production image for the stateless tiers (ingest/query, eval-worker, monitor-worker).
# The same image runs every tier; the Kubernetes command selects the role.
FROM oven/bun:1.3-slim AS base
WORKDIR /app

# Install deps against the lockfile for reproducible builds.
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production || bun install --production

# App source (SDK + server; the web app is built & served separately).
COPY sdk ./sdk
COPY server ./server
COPY tsconfig.json ./

ENV PORT=4318
EXPOSE 4318

# Default role = ingest/query API. Override `command` per Deployment:
#   query API      : bun server/index.ts
#   eval worker    : bun server/evalworker.ts
#   monitor worker : bun server/monitorworker.ts
CMD ["bun", "server/index.ts"]
