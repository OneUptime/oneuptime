#!/usr/bin/env bash

# Print the tag of the latest published GitHub release. Drafts and prereleases
# are intentionally excluded by GitHub's /releases/latest endpoint. A clean
# 404 means the repository has never published a release; every uncertain API
# failure is retried and then fails closed.

set -euo pipefail

if (( $# > 1 )); then
	echo "::error::get_latest_published_release_tag.sh accepts at most one repository argument." >&2
	exit 2
fi

repository="${1:-${REPOSITORY:-${GITHUB_REPOSITORY:-}}}"
if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
	echo "::error::Repository must have the form owner/name; got '${repository}'." >&2
	exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
	echo "::error::The GitHub CLI (gh) is required to resolve the previous release." >&2
	exit 2
fi

GET_LATEST_RELEASE_RETRY_DELAYS="${GET_LATEST_RELEASE_RETRY_DELAYS-5 15 30}"
declare -a retry_delays=()
read -ra retry_delays <<< "$GET_LATEST_RELEASE_RETRY_DELAYS" || true

for retry_delay in "${retry_delays[@]}"; do
	if [[ ! "$retry_delay" =~ ^[0-9]+$ ]]; then
		echo "::error::GET_LATEST_RELEASE_RETRY_DELAYS must contain non-negative integer seconds." >&2
		exit 2
	fi
done

api_stderr_file="$(mktemp "${TMPDIR:-/tmp}/latest-published-release-api.XXXXXX")"
cleanup() {
	rm -f "$api_stderr_file"
}
trap cleanup EXIT

transient_api_errors='HTTP (408|425|429|500|502|503|504)|Request Timeout|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time|rate limit|connection reset|connection refused|Could not resolve host|temporary failure in name resolution|TLS handshake timeout|operation timed out|context deadline exceeded|unexpected EOF'
max_attempts=$(( ${#retry_delays[@]} + 1 ))
attempt=1

while true; do
	response=""
	status=0
	: > "$api_stderr_file"

	if response="$(gh api --method GET "repos/${repository}/releases/latest" --jq .tag_name 2>"$api_stderr_file")"; then
		if [[ -z "$response" || "$response" == "null" || "$response" == *$'\n'* || "$response" == *$'\r'* ]]; then
			echo "::error::GitHub returned an invalid tag for the latest published release." >&2
			exit 1
		fi

		printf '%s\n' "$response"
		exit 0
	else
		status=$?
	fi

	error_text="$(<"$api_stderr_file")"
	if grep -q "HTTP 404" <<< "$error_text"; then
		echo "No previous published GitHub release exists." >&2
		exit 0
	fi

	if ! grep -qiE "$transient_api_errors" <<< "$error_text"; then
		echo "::error::Unable to resolve the latest published release (exit ${status}); GitHub returned a permanent error." >&2
		printf '%s\n' "$error_text" >&2
		exit "$status"
	fi

	if (( attempt >= max_attempts )); then
		echo "::error::Unable to resolve the latest published release after ${max_attempts} attempts (exit ${status})." >&2
		printf '%s\n' "$error_text" >&2
		exit "$status"
	fi

	delay="${retry_delays[attempt - 1]}"
	echo "Latest published release lookup failed on attempt ${attempt}/${max_attempts}; retrying in ${delay}s. GitHub said: ${error_text}" >&2
	sleep "$delay"
	attempt=$(( attempt + 1 ))
done
