#!/usr/bin/env bash
#
# Starts the OneUptime App inside the image .oss-scanner/Dockerfile builds,
# with no network, on http://localhost:3002: the API, the workers, telemetry
# ingestion and every UI (Accounts, Dashboard, Admin Dashboard, Status Page,
# Public Dashboard, docs), as a self-hosted Docker Compose install runs it,
# against the datastores start-services.sh starts. It waits until the App
# reports ready; the first start migrates the empty databases, which takes a
# few minutes.
#
#   bash .oss-scanner/start-app.sh
#   curl http://localhost:3002/status/ready
#
# The App's log: /var/log/oneuptime-app.log. Stop it with
# `kill "$(cat /var/run/oneuptime-app.pid)"`.

set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

bash .oss-scanner/start-services.sh

app_ready() {
  curl -fsS --max-time 5 http://localhost:3002/status/ready
}

if app_ready >/dev/null 2>&1; then
  echo "The App is already up on http://localhost:3002."
  exit 0
fi

# config.env, exported the way every package's scripts export it. Then the
# settings of a self-hosted install rather than of CI's suites: no billing
# (it needs Stripe), and the type check that `npm run compile` already did at
# build time is not done again on every start, as in the App image.
# shellcheck disable=SC2046
export $(grep -v '^#' config.env | xargs)
export BILLING_ENABLED=false
export NODE_ENV=production
export PORT=3002
export TS_NODE_TRANSPILE_ONLY=1

(cd packages/App && exec npm start) >/var/log/oneuptime-app.log 2>&1 &
echo $! >/var/run/oneuptime-app.pid

for _ in $(seq 600); do
  if app_ready >/dev/null 2>&1; then
    echo "The App is up on http://localhost:3002 (log: /var/log/oneuptime-app.log)."
    exit 0
  fi

  if ! kill -0 "$(cat /var/run/oneuptime-app.pid)" 2>/dev/null; then
    echo "start-app.sh: the App exited. The end of its log:" >&2
    tail -n 60 /var/log/oneuptime-app.log >&2
    exit 1
  fi

  sleep 1
done

echo "start-app.sh: the App did not report ready within 10 minutes. Its log: /var/log/oneuptime-app.log" >&2
exit 1
