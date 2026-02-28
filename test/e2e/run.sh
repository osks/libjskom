#!/usr/bin/env bash
set -euo pipefail

cd "$(cd "$(dirname "$0")/../.." && pwd)"

cleanup() {
  echo "Tearing down docker compose..."
  docker compose down -v
}

# Ensure clean state (remove any previous containers and volumes)
docker compose down -v 2>/dev/null || true

trap cleanup EXIT

echo "Starting docker compose..."
docker compose up -d --build

echo "Running e2e tests..."
node --test test/e2e/*.test.js
