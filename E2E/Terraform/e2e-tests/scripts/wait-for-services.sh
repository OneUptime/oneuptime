#!/bin/bash
set -e

# Start all the services in the background
npm run dev

ONEUPTIME_URL="${ONEUPTIME_URL:-http://localhost}"
MAX_RETRIES=60
RETRY_INTERVAL=5

echo "Waiting for OneUptime services to be ready..."

for i in $(seq 1 $MAX_RETRIES); do
    if curl -sf "${ONEUPTIME_URL}/api/status" > /dev/null 2>&1; then
        echo "OneUptime API is ready!"
        exit 0
    fi
    echo "Attempt $i/$MAX_RETRIES - Services not ready yet, waiting ${RETRY_INTERVAL}s..."
    sleep $RETRY_INTERVAL
done

echo "ERROR: OneUptime services failed to start within timeout"
exit 1
