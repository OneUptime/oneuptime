#!/usr/bin/env bash

# Verify that a release tag ultimately resolves to the commit being released.
#
# GitHub's ref API returns a commit directly for a lightweight tag and a tag
# object for an annotated tag. Annotated tags therefore have to be peeled via
# the git/tags API before their commit can be compared with the immutable
# workflow SHA.
#
# Usage:
#   verify_release_tag.sh <owner/repository> <tag> <expected-commit-sha>
#
# Each positional argument can instead be supplied through the environment:
#   repository: REPOSITORY or GITHUB_REPOSITORY
#   tag:        RELEASE_TAG
#   commit:     EXPECTED_SHA or GITHUB_SHA
#
# VERIFY_RELEASE_TAG_RETRY_DELAYS is a space-separated list of delays before
# retries. Its length determines the retry count; setting it to an empty value
# disables retries. Tests set the delays to zero so no network or wall-clock
# time is involved.

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: verify_release_tag.sh [repository] [tag] [expected-commit-sha]

Verify that a GitHub release tag resolves to the expected commit. Values may
be supplied positionally or with GITHUB_REPOSITORY/REPOSITORY, RELEASE_TAG,
and EXPECTED_SHA/GITHUB_SHA.
EOF
}

if (( $# > 3 )); then
	echo "::error::verify_release_tag.sh accepts at most three arguments." >&2
	usage >&2
	exit 2
fi

repository="${1:-${REPOSITORY:-${GITHUB_REPOSITORY:-}}}"
release_tag="${2:-${RELEASE_TAG:-}}"
expected_sha="${3:-${EXPECTED_SHA:-${GITHUB_SHA:-}}}"

if [[ -z "$repository" || -z "$release_tag" || -z "$expected_sha" ]]; then
	echo "::error::Repository, release tag, and expected commit SHA are required." >&2
	usage >&2
	exit 2
fi

if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
	echo "::error::Repository must have the form owner/name; got '${repository}'." >&2
	exit 2
fi

if [[ "$release_tag" == *$'\n'* || "$release_tag" == *$'\r'* ]]; then
	echo "::error::Release tag must not contain a newline." >&2
	exit 2
fi

if [[ ! "$expected_sha" =~ ^[0-9A-Fa-f]{40}$ ]]; then
	echo "::error::Expected commit SHA must be a complete 40-character Git SHA." >&2
	exit 2
fi

if ! command -v gh >/dev/null 2>&1; then
	echo "::error::The GitHub CLI (gh) is required to verify the release tag." >&2
	exit 2
fi

if ! command -v jq >/dev/null 2>&1; then
	echo "::error::jq is required to parse the GitHub API response." >&2
	exit 2
fi

VERIFY_RELEASE_TAG_RETRY_DELAYS="${VERIFY_RELEASE_TAG_RETRY_DELAYS-5 15 30}"
VERIFY_RELEASE_TAG_MAX_PEELS="${VERIFY_RELEASE_TAG_MAX_PEELS-20}"

if [[ ! "$VERIFY_RELEASE_TAG_MAX_PEELS" =~ ^[1-9][0-9]*$ ]]; then
	echo "::error::VERIFY_RELEASE_TAG_MAX_PEELS must be a positive integer." >&2
	exit 2
fi

declare -a retry_delays=()
# `read` reports failure for an empty override under some bash versions. An
# empty list intentionally means one attempt with no retries.
read -ra retry_delays <<< "$VERIFY_RELEASE_TAG_RETRY_DELAYS" || true
retry_delay_count="${#retry_delays[@]}"
for (( retry_delay_index = 0; retry_delay_index < retry_delay_count; retry_delay_index++ )); do
	retry_delay="${retry_delays[retry_delay_index]}"
	if [[ ! "$retry_delay" =~ ^[0-9]+$ ]]; then
		echo "::error::VERIFY_RELEASE_TAG_RETRY_DELAYS must contain non-negative integer seconds." >&2
		exit 2
	fi
done

api_stderr_file="$(mktemp "${TMPDIR:-/tmp}/verify-release-tag-api.XXXXXX")"
parse_stderr_file="$(mktemp "${TMPDIR:-/tmp}/verify-release-tag-parse.XXXXXX")"
cleanup() {
	rm -f "$api_stderr_file" "$parse_stderr_file"
}
trap cleanup EXIT

# GitHub CLI usually includes an HTTP status and reason phrase in API errors.
# The network phrases cover failures that occur before an HTTP response exists.
transient_api_errors='HTTP (408|425|429|500|502|503|504)|Request Timeout|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Time|rate limit|connection reset|connection refused|Could not resolve host|temporary failure in name resolution|TLS handshake timeout|operation timed out|context deadline exceeded|unexpected EOF'

is_transient_api_error() {
	local error_text="$1"
	grep -qiE "$transient_api_errors" <<< "$error_text"
}

API_RESPONSE=""

# gh_api_with_retry <endpoint> <human-readable object description>
#
# On success, the response is placed in API_RESPONSE. Logs stay on stderr so
# JSON never gets mixed with retry messages.
gh_api_with_retry() {
	local endpoint="$1"
	local description="$2"
	local max_attempts=$(( retry_delay_count + 1 ))
	local attempt=1
	local status=0
	local error_text=""

	while true; do
		API_RESPONSE=""
		: > "$api_stderr_file"
		status=0

		if API_RESPONSE="$(gh api --method GET "$endpoint" 2>"$api_stderr_file")"; then
			if (( attempt > 1 )); then
				echo "✅ GitHub API request for ${description} succeeded on attempt ${attempt}/${max_attempts}." >&2
			fi
			return 0
		else
			status=$?
		fi

		error_text="$(<"$api_stderr_file")"
		if [[ -n "$error_text" ]]; then
			printf '%s\n' "$error_text" >&2
		fi

		if ! is_transient_api_error "$error_text"; then
			echo "::error::GitHub API request for ${description} failed (exit ${status}); the error is not transient, so it will not be retried." >&2
			return "$status"
		fi

		if (( attempt >= max_attempts )); then
			echo "::error::GitHub API request for ${description} still failed after ${max_attempts} attempts (exit ${status})." >&2
			return "$status"
		fi

		local delay="${retry_delays[attempt - 1]}"
		echo "⚠️  GitHub API request for ${description} failed on attempt ${attempt}/${max_attempts}; retrying in ${delay}s." >&2
		sleep "$delay"
		attempt=$(( attempt + 1 ))
	done
}

OBJECT_TYPE=""
OBJECT_SHA=""

# Parse the common `.object.type` / `.object.sha` shape returned by both the
# refs and annotated-tags endpoints. A successful HTTP response with invalid or
# incomplete JSON is a hard failure; retrying cannot turn that response into a
# trustworthy provenance result.
parse_git_object() {
	local description="$1"
	local object_record=""
	local extra_field=""

	: > "$parse_stderr_file"
	if ! object_record="$(jq -er '
		if (.object | type) == "object"
			and (.object.type | type) == "string"
			and (.object.sha | type) == "string"
		then [.object.type, .object.sha] | @tsv
		else empty
		end
	' <<< "$API_RESPONSE" 2>"$parse_stderr_file")"; then
		if [[ -s "$parse_stderr_file" ]]; then
			cat "$parse_stderr_file" >&2
		fi
		echo "::error::GitHub returned a malformed response for ${description}; object.type and object.sha are required." >&2
		return 1
	fi

	IFS=$'\t' read -r OBJECT_TYPE OBJECT_SHA extra_field <<< "$object_record"
	if [[ -n "$extra_field" || ! "$OBJECT_TYPE" =~ ^(commit|tag|tree|blob)$ || ! "$OBJECT_SHA" =~ ^[0-9A-Fa-f]{40}$ ]]; then
		echo "::error::GitHub returned a malformed Git object for ${description}." >&2
		return 1
	fi

	OBJECT_SHA="$(tr '[:upper:]' '[:lower:]' <<< "$OBJECT_SHA")"
}

expected_sha="$(tr '[:upper:]' '[:lower:]' <<< "$expected_sha")"
encoded_release_tag="$(jq -rn --arg value "$release_tag" '$value | @uri')"

ref_endpoint="repos/${repository}/git/ref/tags/${encoded_release_tag}"
gh_api_with_retry "$ref_endpoint" "release tag ${release_tag}"
parse_git_object "release tag ${release_tag}"

peel_count=0
while [[ "$OBJECT_TYPE" == "tag" ]]; do
	if (( peel_count >= VERIFY_RELEASE_TAG_MAX_PEELS )); then
		echo "::error::Release tag ${release_tag} exceeds the ${VERIFY_RELEASE_TAG_MAX_PEELS}-object annotated-tag peel limit." >&2
		exit 1
	fi
	peel_count=$(( peel_count + 1 ))

	tag_object_sha="$OBJECT_SHA"
	gh_api_with_retry "repos/${repository}/git/tags/${tag_object_sha}" "annotated tag object ${tag_object_sha}"
	parse_git_object "annotated tag object ${tag_object_sha}"
done

if [[ "$OBJECT_TYPE" != "commit" ]]; then
	echo "::error::Release tag ${release_tag} resolves to ${OBJECT_TYPE}, not a commit." >&2
	exit 1
fi

if [[ "$OBJECT_SHA" != "$expected_sha" ]]; then
	echo "::error::Release tag ${release_tag} points to ${OBJECT_SHA}; this workflow is releasing ${expected_sha}." >&2
	exit 1
fi

echo "✅ Release tag ${release_tag} is pinned to ${expected_sha}."
