#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec docker run --rm --init \
  --publish 127.0.0.1:5173:5173 \
  --volume "$root:/app" \
  --volume /app/node_modules \
  --workdir /app \
  node:22-alpine \
  sh -c 'npm ci && npm run dev -- --port 5173 --strictPort'
