#!/usr/bin/env bash

# Shared retry helper for registry writes. Source it; it defines one function
# and runs nothing on its own.
#
# The release workflow builds ~10 images across two architectures, and every one
# of those jobs pushes to GHCR and Docker Hub at roughly the same moment. That
# burst is enough to trip GitHub's *secondary* rate limit, which GHCR surfaces
# as a push failure that reads like a permissions problem:
#
#   failed to push ghcr.io/oneuptime/runner:12.0.0-test-arm64: denied:
#   permission_denied: Error from intermediary with HTTP status code 403
#   "Forbidden" - with-body: {"message": "You have exceeded a secondary rate
#   limit. Please wait a few minutes before you try again. ..."}
#
# The "denied"/"permission_denied"/403 wrapper is misleading — nothing is
# actually wrong with the token or the package ACL, and the same push from the
# sibling architecture job succeeds. GitHub's own guidance is to wait and retry,
# so that is what this does. The delays are in minutes rather than seconds
# because a secondary limit does not clear in a few hundred milliseconds.
#
# Retrying is safe for both callers: a `docker buildx build --push` re-run
# reuses the in-builder layer cache (the builder outlives the attempt), and
# `docker buildx imagetools create` is idempotent — it rewrites the same tag
# from the same per-arch digests.

# Seconds to wait before each retry, space separated; the count also sets the
# attempt limit (delays + 1). See RETRY_REGISTRY_READ_DELAYS below for why this
# is an overridable string rather than an array.
RETRY_WITH_BACKOFF_DELAYS="${RETRY_WITH_BACKOFF_DELAYS-60 150 300}"

# retry_with_backoff <description> <command> [args...]
#
# Runs the command, retrying on any non-zero exit with escalating delays.
# Returns the final attempt's exit status.
retry_with_backoff() {
	local description="$1"
	shift

	local -a delays=()
	# `|| true` because read reports failure at EOF; the herestring always
	# supplies a trailing newline, but an empty override would trip `set -e`.
	read -ra delays <<< "$RETRY_WITH_BACKOFF_DELAYS" || true
	local max_attempts=$(( ${#delays[@]} + 1 ))
	local attempt=1

	while true; do
		# Capture the status on the same line: after a failed `if` with no
		# else branch, $? is 0, not the command's exit code.
		local status=0
		"$@" || status=$?

		if (( status == 0 )); then
			if (( attempt > 1 )); then
				echo "✅ ${description} succeeded on attempt ${attempt}/${max_attempts}"
			fi
			return 0
		fi

		if (( attempt >= max_attempts )); then
			echo "❌ ${description} failed after ${max_attempts} attempts (exit ${status})" >&2
			return "$status"
		fi

		local delay="${delays[attempt - 1]}"
		echo "⚠️  ${description} failed on attempt ${attempt}/${max_attempts} (exit ${status}). Retrying in ${delay}s — this is usually a GitHub secondary rate limit from the parallel image pushes." >&2
		sleep "$delay"
		attempt=$(( attempt + 1 ))
	done
}

# Registry *reads* fail differently from the pushes above, so they get their own
# helper rather than reusing the one written for the push burst.
#
# The SBOM job walks every layer of all twelve published images on both
# architectures — 24 scans, back to back, each one fetching every blob. That is
# a read-rate problem rather than a secondary-limit problem, and GHCR says so
# plainly:
#
#   oci-registry: GET https://ghcr.io/v2/oneuptime/home/blobs/sha256:ea1eb2d3…:
#   TOOMANYREQUESTS: retry-after: 390.000224ms
#
# That is the error that stranded 12.0.27. syft gave up on the first 429 partway
# through the home image, the step exited 1, and because finalize-github-release
# needs that job the release sat as a permanent draft — after every image and
# tag had already gone out.
#
# Two things differ from retry_with_backoff. The delays are seconds, not
# minutes: a request-rate limit clears on the timescale the registry itself
# advertises (390ms above), so minute-scale waits would just burn CI time. And
# the retry is *conditional*, which matters much more here than it does for a
# push. A read that fails because the tag was never pushed (MANIFEST_UNKNOWN),
# because the token cannot see it (UNAUTHORIZED), or because the platform is not
# in the index will fail identically forever. Retrying all 24 scans through the
# full backoff would turn a build that should go red in a minute into one that
# grinds for the better part of an hour before reporting the same thing.
#
# Matched case-insensitively against the failing command's stderr. Every entry
# is a phrase a registry or its transport emits for a condition that a later
# attempt can plausibly clear — rate limits, availability blips, and connections
# dropped mid-read. Case-insensitive because the same condition is spelled
# differently by each client: syft says "TOOMANYREQUESTS", docker says
# "toomanyrequests". Bare status numbers are deliberately spelled out with their
# reason phrase ("429 Too Many Requests", not "429") because these messages quote
# blob digests, and a hex digest containing "429" would otherwise look retryable.
RETRYABLE_REGISTRY_READ_ERRORS='TOOMANYREQUESTS|too many requests|429 Too Many Requests|rate limit|500 Internal Server Error|502 Bad Gateway|503 Service Unavailable|504 Gateway Time|connection reset|connection refused|unexpected EOF|i/o timeout|TLS handshake timeout|no such host|context deadline exceeded'

# Seconds to wait before each retry, space separated; the count also sets the
# attempt limit (delays + 1), and an empty value disables retrying altogether.
# A string rather than an array because it is overridable through the
# environment, and bash cannot export an array — Scripts/GHA/Tests uses that to
# exercise the retry path without sleeping for minutes. CI and production leave
# it alone.
RETRY_REGISTRY_READ_DELAYS="${RETRY_REGISTRY_READ_DELAYS-15 45 120}"

# retry_registry_read <description> <command> [args...]
#
# Runs the command, retrying only while its stderr names one of the transient
# registry failures above. Returns the final attempt's exit status.
#
# Unlike retry_with_backoff this buffers stderr for the length of each attempt
# so it can be matched. It is replayed to the log either way, so no output is
# lost, but do not use it for a command whose progress needs to stream live.
retry_registry_read() {
	local description="$1"
	shift

	local -a delays=()
	# `|| true` because read reports failure at EOF; the herestring always
	# supplies a trailing newline, but an empty override would trip `set -e`.
	read -ra delays <<< "$RETRY_REGISTRY_READ_DELAYS" || true
	local max_attempts=$(( ${#delays[@]} + 1 ))
	local attempt=1

	local stderr_file
	stderr_file="$(mktemp)"

	while true; do
		# Capture the status on the same line: after a failed `if` with no
		# else branch, $? is 0, not the command's exit code.
		local status=0
		"$@" 2>"$stderr_file" || status=$?

		cat "$stderr_file" >&2

		if (( status == 0 )); then
			if (( attempt > 1 )); then
				echo "✅ ${description} succeeded on attempt ${attempt}/${max_attempts}"
			fi
			rm -f "$stderr_file"
			return 0
		fi

		if ! grep -qiE "$RETRYABLE_REGISTRY_READ_ERRORS" "$stderr_file"; then
			echo "❌ ${description} failed on attempt ${attempt}/${max_attempts} (exit ${status}). Nothing in its output looks like a transient registry error, so retrying would not help." >&2
			rm -f "$stderr_file"
			return "$status"
		fi

		if (( attempt >= max_attempts )); then
			echo "❌ ${description} still hitting transient registry errors after ${max_attempts} attempts (exit ${status})" >&2
			rm -f "$stderr_file"
			return "$status"
		fi

		local delay="${delays[attempt - 1]}"
		echo "⚠️  ${description} hit a transient registry error on attempt ${attempt}/${max_attempts}. Retrying in ${delay}s." >&2
		sleep "$delay"
		attempt=$(( attempt + 1 ))
	done
}
