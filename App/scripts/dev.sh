#!/usr/bin/env bash

set -euo pipefail

pids=()

cleanup() {
  for pid in "${pids[@]}"; do
    if kill -0 "$pid" >/dev/null 2>&1; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
}

trap cleanup EXIT INT TERM

npm run build-frontends

npm run watch-frontend:accounts &
pids+=($!)

npm run watch-frontend:dashboard &
pids+=($!)

npm run watch-frontend:admin-dashboard &
pids+=($!)

npm run watch-frontend:status-page &
pids+=($!)

npm run watch-frontend:public-dashboard &
pids+=($!)

npm run dev:api &
pids+=($!)

wait -n "${pids[@]}"
