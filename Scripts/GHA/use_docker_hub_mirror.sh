#!/usr/bin/env bash
#
# Points this runner's Docker daemon at Google's public Docker Hub mirror,
# mirror.gcr.io, before the job pulls any image. .github/actions/
# docker-hub-mirror runs it; it needs nothing but a GitHub-hosted Linux runner.
#
# Why: the test jobs pull postgres, valkey and clickhouse from Docker Hub with
# no account, and Docker Hub caps anonymous pulls per runner IP and has bad
# hours. On 2026-10-09 (~21:26 UTC, fb78dc289a) its token service timed out
# and answered "toomanyrequests: You have reached your unauthenticated pull
# rate limit" to every such pull: all eight Common Test shards, App Test, the
# Enterprise Edition and Ops Config tests, Postgres Schema Drift and Terraform
# Provider E2E failed before running a test.
#
# A registry mirror only changes where the daemon looks first: an image the
# mirror cannot serve, or a mirror that does not answer, falls back to Docker
# Hub, as before. mirror.gcr.io serves every image these jobs pull, without an
# account. What it does serve, the daemon takes as the image of that tag
# without asking Docker Hub, so this is only for jobs whose Docker Hub images
# are other people's: never for one that pulls OneUptime's own images under
# tags pushed again on every master push or release (the e2e jobs).
#
# The daemon picks up registry-mirrors on a reload (SIGHUP), so this never
# restarts it: a restart would stop the job's service containers, which the
# runner starts before the first step. Nothing here fails the job either -- if
# the mirror cannot be set, the job pulls from Docker Hub as it always has,
# with a warning saying so.
#
# Overridable for Scripts/GHA/Tests/use_docker_hub_mirror_test.sh:
#   DOCKER_DAEMON_JSON   the daemon's config file (/etc/docker/daemon.json)
#   DOCKER_HUB_MIRROR    the mirror (https://mirror.gcr.io)
#   MIRROR_WAIT_SECONDS  how long to wait for the reload to show (20)

set -uo pipefail

DAEMON_JSON="${DOCKER_DAEMON_JSON:-/etc/docker/daemon.json}"
MIRROR="${DOCKER_HUB_MIRROR:-https://mirror.gcr.io}"
WAIT_SECONDS="${MIRROR_WAIT_SECONDS:-20}"

warn() {
	echo "::warning title=Docker Hub mirror not used::$1 This job pulls Docker Hub images from Docker Hub itself."
}

# The mirrors the running daemon uses. Docker writes them back normalised
# ("https://mirror.gcr.io/"), so callers look for the host, not the string.
daemon_mirrors() {
	docker info --format '{{json .RegistryConfig.Mirrors}}' 2>/dev/null
}

mirror_host="${MIRROR#*://}"
mirror_host="${mirror_host%%/*}"

if daemon_mirrors | grep -qF "$mirror_host"; then
	echo "The Docker daemon already pulls Docker Hub images through ${MIRROR}."
	exit 0
fi

work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT

# The daemon's config with the mirror first, everything else kept as it was.
# The runner's own settings (cgroup driver, cgroup parent, ...) live in the
# same file.
if ! python3 - "$DAEMON_JSON" "$MIRROR" >"${work_dir}/daemon.json" <<'PYTHON'
import json
import os
import sys

path, mirror = sys.argv[1], sys.argv[2]
config = {}
if os.path.exists(path):
    with open(path) as source:
        text = source.read().strip()
    if text:
        config = json.loads(text)
if not isinstance(config, dict):
    raise SystemExit("not a JSON object")
mirrors = config.get("registry-mirrors") or []
if not isinstance(mirrors, list):
    raise SystemExit("registry-mirrors is not a list")
config["registry-mirrors"] = [mirror] + [m for m in mirrors if m != mirror]
json.dump(config, sys.stdout, indent=2)
sys.stdout.write("\n")
PYTHON
then
	warn "${DAEMON_JSON} could not be read as a JSON object, so it was left as it was."
	exit 0
fi

had_config="false"
if [[ -e "$DAEMON_JSON" ]]; then
	had_config="true"
	cp "$DAEMON_JSON" "${work_dir}/daemon.json.before"
fi

# Puts the daemon's config back as it was found and reloads it, after a reload
# that did not take the mirror.
restore() {
	if [[ "$had_config" == "true" ]]; then
		sudo cp "${work_dir}/daemon.json.before" "$DAEMON_JSON"
	else
		sudo rm -f "$DAEMON_JSON"
	fi
	sudo systemctl reload docker || true
}

if ! sudo mkdir -p "$(dirname "$DAEMON_JSON")" ||
	! sudo cp "${work_dir}/daemon.json" "$DAEMON_JSON"; then
	warn "${DAEMON_JSON} could not be written."
	exit 0
fi

if ! sudo systemctl reload docker; then
	restore
	warn "The Docker daemon could not be reloaded."
	exit 0
fi

for ((second = 0; second < WAIT_SECONDS; second++)); do
	if daemon_mirrors | grep -qF "$mirror_host"; then
		echo "The Docker daemon now pulls Docker Hub images through ${MIRROR}, and from Docker Hub when the mirror cannot serve one."
		exit 0
	fi
	sleep 1
done

restore
warn "The Docker daemon did not take ${MIRROR} within ${WAIT_SECONDS} seconds of a reload."
exit 0
