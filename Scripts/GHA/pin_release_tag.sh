#!/usr/bin/env bash

# Create the release tag at the immutable workflow commit before any downstream
# publishing job can start, or verify an existing tag on a safe same-commit
# rerun. GitHub draft releases do not create their Git tag until publication,
# so relying on release creation alone leaves the eventual tag vulnerable to a
# moving target branch.

set -euo pipefail

usage() {
	cat <<'EOF'
Usage: pin_release_tag.sh <owner/repository> <tag> <expected-commit-sha>

Create a missing lightweight release tag at the expected commit, then verify
that the remote tag resolves to that exact commit. Existing tags are never
moved.
EOF
}

if (( $# != 3 )); then
	echo "::error::pin_release_tag.sh requires repository, tag, and expected commit SHA." >&2
	usage >&2
	exit 2
fi

repository="$1"
release_tag="$2"
expected_sha="$3"

if [[ ! "$repository" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]]; then
	echo "::error::Repository must have the form owner/name; got '${repository}'." >&2
	exit 2
fi

if [[ ! "$expected_sha" =~ ^[0-9A-Fa-f]{40}$ ]]; then
	echo "::error::Expected commit SHA must be a complete 40-character Git SHA." >&2
	exit 2
fi

if ! command -v git >/dev/null 2>&1; then
	echo "::error::Git is required to pin the release tag." >&2
	exit 2
fi

if ! git check-ref-format "refs/tags/${release_tag}" >/dev/null 2>&1; then
	echo "::error::'${release_tag}' is not a valid Git tag name." >&2
	exit 2
fi

script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
verify_helper="${VERIFY_RELEASE_TAG_HELPER:-${script_directory}/verify_release_tag.sh}"

if [[ ! -f "$verify_helper" ]]; then
	echo "::error::Release tag verifier was not found at '${verify_helper}'." >&2
	exit 2
fi

remote_ref="refs/tags/${release_tag}"
lookup_output=""
lookup_status=0

if lookup_output="$(git ls-remote --exit-code --tags origin "$remote_ref" 2>&1)"; then
	echo "Release tag ${release_tag} already exists; verifying that this is a safe same-commit rerun."
else
	lookup_status=$?

	# git ls-remote --exit-code reserves status 2 for a successful lookup with
	# no matching refs. Every other failure leaves the remote state unknown.
	if (( lookup_status != 2 )); then
		echo "::error::Unable to determine whether release tag ${release_tag} exists (git ls-remote exited ${lookup_status})." >&2
		printf '%s\n' "$lookup_output" >&2
		exit 1
	fi

	echo "Release tag ${release_tag} does not exist; pinning it to ${expected_sha}."
	# A direct <sha>:<ref> push creates a lightweight tag atomically. Git
	# refuses to overwrite a tag if another actor wins a race, so this command
	# fails closed and the next run verifies the winner instead of moving it.
	git push origin "${expected_sha}:${remote_ref}"
fi

bash "$verify_helper" "$repository" "$release_tag" "$expected_sha"
