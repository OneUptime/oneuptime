#!/bin/sh
# OneUptime Docker Agent entrypoint.
#
# Runs the inventory snapshot poller in the background and execs the
# OTel collector in the foreground. The collector is the supervised
# process; if it dies the container restarts. The poller is treated
# as best-effort — its failure does not take down the agent.

set -eu

# Start the inventory poller in the background. Output goes to a log
# file watched by a filelog receiver inside the collector, so we can
# also tee its own stderr to stdout for container logs.
/usr/local/bin/oneuptime-docker-inventory.sh &

# Hand off to the collector. The base image's CMD provides the right
# args; we just exec it.
exec /otelcol-contrib --config=/etc/otelcol-contrib/config.yaml
