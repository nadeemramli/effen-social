# EFFEN media worker — FFmpeg + Node. Long-running container; never runs
# inside a web request. Build from the repo root:
#   docker build -f apps/worker/Dockerfile -t effen-worker .
FROM node:22-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg ca-certificates \
  && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
RUN pnpm install --frozen-lockfile --filter worker --filter @effen/core

COPY packages/core packages/core
COPY apps/worker apps/worker

USER node
CMD ["pnpm", "--filter", "worker", "start"]
