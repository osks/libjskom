#!/usr/bin/env bash
set -euo pipefail

E2E_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(dirname "$(dirname "$E2E_DIR")")"

cleanup() {
  echo "Tearing down docker compose..."
  docker compose -f "$E2E_DIR/docker-compose.yml" down -v --remove-orphans
}

docker compose -f "$E2E_DIR/docker-compose.yml" down -v --remove-orphans 2>/dev/null || true

trap cleanup EXIT

echo "Building TypeScript..."
npm --prefix "$ROOT_DIR" run build

echo "Starting docker compose..."
docker compose -f "$E2E_DIR/docker-compose.yml" up -d --build

echo "Running e2e tests..."
node --test --test-concurrency=1 "$ROOT_DIR/test/e2e/"*.test.js
