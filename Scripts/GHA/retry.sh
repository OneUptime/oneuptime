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

# retry_with_backoff <description> <command> [args...]
#
# Runs the command, retrying on any non-zero exit with escalating delays.
# Returns the final attempt's exit status.
retry_with_backoff() {
	local description="$1"
	shift

	local -a delays=(60 150 300)
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
