#!/usr/bin/env bash

# Logs in to a Docker registry, retrying on transient failures.
#
# Container registry logins reach out to an auth endpoint over the network
# (auth.docker.io for Docker Hub, ghcr.io for GitHub Container Registry). Those
# requests occasionally fail with transient errors like "connection reset by
# peer" or short-lived 5xx / rate-limit responses, which used to fail an entire
# release job on the very first step. This wrapper retries the login a handful
# of times with exponential backoff so a blip no longer turns the build red.
#
# The password is read from stdin (never passed as an argument) so it does not
# leak into the process list or shell history.
#
# Usage:
#   echo "$PASSWORD" | docker_login.sh --username <user>                 # Docker Hub
#   echo "$TOKEN"    | docker_login.sh --registry ghcr.io --username <user>

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: docker_login.sh --username <user> [--registry <registry>]

Reads the password/token from stdin and logs in to the registry, retrying on
transient network failures.

Required flags:
	--username <user>       Registry username.

Optional flags:
	--registry <registry>   Registry host (e.g. ghcr.io). Omit for Docker Hub.
	--max-attempts <n>      Number of attempts before giving up (default: 5).
EOF
}

REGISTRY=""
USERNAME=""
MAX_ATTEMPTS=5

while [[ $# -gt 0 ]]; do
	case "$1" in
	--registry)
		REGISTRY="$2"
		shift 2
		;;
	--username)
		USERNAME="$2"
		shift 2
		;;
	--max-attempts)
		MAX_ATTEMPTS="$2"
		shift 2
		;;
	-h | --help)
		usage
		exit 0
		;;
	*)
		echo "Unknown argument: $1" >&2
		usage >&2
		exit 1
		;;
	esac
done

if [[ -z "$USERNAME" ]]; then
	echo "Error: --username is required." >&2
	usage >&2
	exit 1
fi

# Read the secret once from stdin so we can reuse it across retries.
PASSWORD="$(cat)"

REGISTRY_LABEL="${REGISTRY:-Docker Hub}"

attempt=1
delay=5
while true; do
	# Assemble the docker login arguments. Docker Hub takes no registry arg.
	login_args=(login)
	if [[ -n "$REGISTRY" ]]; then
		login_args+=("$REGISTRY")
	fi
	login_args+=(--username "$USERNAME" --password-stdin)

	if printf '%s' "$PASSWORD" | docker "${login_args[@]}"; then
		echo "Docker login to ${REGISTRY_LABEL} succeeded (attempt ${attempt})."
		break
	fi

	if ((attempt >= MAX_ATTEMPTS)); then
		echo "Docker login to ${REGISTRY_LABEL} failed after ${attempt} attempts." >&2
		exit 1
	fi

	echo "Docker login to ${REGISTRY_LABEL} failed (attempt ${attempt}); retrying in ${delay}s..." >&2
	sleep "$delay"
	attempt=$((attempt + 1))
	delay=$((delay * 2))
done
