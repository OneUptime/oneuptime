#!/bin/sh
# OneUptime Docker Agent — inventory snapshot poller.
#
# Periodically queries the local Docker daemon for the full set of
# containers (all states), images, networks, and volumes and writes
# one JSON line per resource to a log file that the OTel filelog
# receiver picks up and forwards to OneUptime.
#
# Each line is a JSON envelope:
#   {"oneuptime.docker.kind":"Container","data":{...native docker payload...}}
#
# The collector's filelog operator chain promotes the kind to a log
# record attribute and moves `data` to the body, so the backend
# inventory ingest sees the same shape per record.
#
# Output is truncated on each run so we always emit a fresh snapshot
# rather than tailing a growing file. We write to a `.tmp` sibling
# and atomically rename so the collector never reads a half-written
# file.

set -eu

SOCKET="${DOCKER_INVENTORY_SOCKET:-/var/run/docker.sock}"
LOG_PATH="${DOCKER_INVENTORY_LOG_PATH:-/var/log/oneuptime-docker-inventory.log}"
INTERVAL="${DOCKER_INVENTORY_INTERVAL_SECONDS:-300}"

# Pin to a modern API version that matches the docker_stats receiver
# pin so we don't get rejected on newer daemons.
DOCKER_API="http://localhost/v1.44"

emit_array_endpoint() {
    kind="$1"
    endpoint="$2"

    # The endpoints return a JSON array. We pipe through jq to:
    #   1. unwrap the array (.[]),
    #   2. wrap each element in the OneUptime envelope ({kind, data}),
    #   3. -c gives one compact JSON object per line, which is what
    #      the filelog json_parser operator expects.
    if ! curl --silent --fail --unix-socket "${SOCKET}" \
        "${DOCKER_API}${endpoint}" 2>/dev/null \
        | jq -c --arg kind "${kind}" '.[] | {"oneuptime.docker.kind":$kind,"data":.}' \
        >> "${LOG_PATH}.tmp" 2>/dev/null; then
        # A failed scrape for one kind shouldn't kill the loop; the
        # next iteration retries. Most likely cause is the daemon
        # being temporarily unavailable.
        echo "oneuptime-inventory: failed to scrape ${kind}" >&2
    fi
}

emit_volumes() {
    # /volumes returns an object with a Volumes array, not a bare
    # array, so we extract .Volumes[] instead of .[].
    if ! curl --silent --fail --unix-socket "${SOCKET}" \
        "${DOCKER_API}/volumes" 2>/dev/null \
        | jq -c '.Volumes[]? | {"oneuptime.docker.kind":"Volume","data":.}' \
        >> "${LOG_PATH}.tmp" 2>/dev/null; then
        echo "oneuptime-inventory: failed to scrape Volume" >&2
    fi
}

while :; do
    : > "${LOG_PATH}.tmp"

    # all=true so we get exited/paused containers, not just running.
    emit_array_endpoint "Container" "/containers/json?all=true"
    emit_array_endpoint "Image" "/images/json"
    emit_array_endpoint "Network" "/networks"
    emit_volumes

    mv "${LOG_PATH}.tmp" "${LOG_PATH}"

    sleep "${INTERVAL}"
done
