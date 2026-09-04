#!/bin/sh
# OneUptime Podman Agent — inventory snapshot poller.
#
# Periodically queries the local Podman daemon (over its Docker-API
# compatible socket) for the full set of containers (all states),
# images, networks, and volumes and writes one JSON line per resource
# to a log file that the OTel filelog receiver picks up and forwards
# to OneUptime.
#
# Each line is a JSON envelope:
#   {"oneuptime.podman.kind":"Container","data":{...native podman payload...}}
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

SOCKET="${PODMAN_INVENTORY_SOCKET:-/run/podman/podman.sock}"
LOG_PATH="${PODMAN_INVENTORY_LOG_PATH:-/var/log/oneuptime-podman-inventory.log}"
INTERVAL="${PODMAN_INVENTORY_INTERVAL_SECONDS:-300}"
API_VERSION="${DOCKER_API_VERSION-1.44}"

# Follow the collector's DOCKER_API_VERSION so that a host which lowers the
# docker_stats receiver's version for an older daemon lowers ours too.
#
# Note the "-" rather than ":-": unset means "use the shipped default", but an
# explicitly EMPTY value is the documented "let the server pick" escape hatch.
# The collector answers that by auto-negotiating; curl has no negotiation, so we
# answer it by dropping the /v<version> prefix -- the Docker API serves those
# unversioned paths at the daemon's own latest version, which is the same
# outcome. A pinned modern default keeps newer daemons from rejecting us with
# "client version too old".
# Podman's Docker-API compatible socket serves the same versioned endpoints.
if [ -n "${API_VERSION}" ]; then
    PODMAN_API="http://localhost/v${API_VERSION}"
else
    PODMAN_API="http://localhost"
fi

emit_array_endpoint() {
    kind="$1"
    endpoint="$2"

    # The endpoints return a JSON array. We pipe through jq to:
    #   1. unwrap the array (.[]),
    #   2. wrap each element in the OneUptime envelope ({kind, data}),
    #   3. -c gives one compact JSON object per line, which is what
    #      the filelog json_parser operator expects.
    if ! curl --silent --fail --unix-socket "${SOCKET}" \
        "${PODMAN_API}${endpoint}" 2>/dev/null \
        | jq -c --arg kind "${kind}" '.[] | {"oneuptime.podman.kind":$kind,"data":.}' \
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
        "${PODMAN_API}/volumes" 2>/dev/null \
        | jq -c '.Volumes[]? | {"oneuptime.podman.kind":"Volume","data":.}' \
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
