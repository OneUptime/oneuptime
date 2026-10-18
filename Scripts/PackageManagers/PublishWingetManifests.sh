#!/usr/bin/env bash
#
# Opens the pull request that adds one release of the OneUptime
# infrastructure agent to winget (microsoft/winget-pkgs), for
#
#   winget install --id OneUptime.InfrastructureAgent
#
# GoReleaser writes the manifests (agents/InfrastructureAgent/.goreleaser.yaml,
# winget) in infrastructure-agent-build; release.yml's
# publish-infrastructure-agent-winget job runs this once the GitHub release
# they download from is published. Environment:
#
#   PACKAGE_VERSION        the release's version
#   WINGET_MANIFESTS       the directory GoReleaser wrote this version's three
#                          manifests to
#   WINGET_GITHUB_TOKEN    a classic token with the public_repo scope, of the
#                          account that owns the fork the pull request comes
#                          from (a fine-grained token cannot open a pull
#                          request on microsoft/winget-pkgs)
#   WINGET_FORK_OWNER      optional: the owner of that fork, when it is not
#                          the token's account (an organization's fork)
#
# (WINGET_UPSTREAM, WINGET_UPSTREAM_BRANCH and WINGET_RETRY_DELAY_SECONDS are
# for the tests.)
#
# winget-pkgs takes a pull request from a fork; Microsoft's checks validate it
# and a moderator or a bot merges it. Nothing is cloned: winget-pkgs is
# several gigabytes. The branch is made in the fork at winget-pkgs' newest
# commit (a fork shares its parent's objects), the manifests are committed to
# it through the API, and the pull request is opened from it, as GoReleaser
# itself does.
#
# A version winget-pkgs already has, or one with a pull request open, is
# left alone, so a re-run opens nothing twice. Only a clean 404 counts as
# "not there"; any other answer is asked again and then stops the job.

set -euo pipefail

readonly PACKAGE_ID="OneUptime.InfrastructureAgent"
readonly PACKAGE_DIR="manifests/o/OneUptime/InfrastructureAgent"
readonly UPSTREAM="${WINGET_UPSTREAM:-microsoft/winget-pkgs}"
readonly UPSTREAM_BRANCH="${WINGET_UPSTREAM_BRANCH:-master}"
readonly MANIFESTS=(
	"$PACKAGE_ID.yaml"
	"$PACKAGE_ID.installer.yaml"
	"$PACKAGE_ID.locale.en-US.yaml"
)

VERSION="${PACKAGE_VERSION:-}"

fail() {
	echo "PublishWingetManifests: $*" >&2
	exit 1
}

[[ -n "$VERSION" ]] || fail "PACKAGE_VERSION is required"
[[ -d "${WINGET_MANIFESTS:-}" ]] || fail "WINGET_MANIFESTS must be a directory: '${WINGET_MANIFESTS:-}'"
[[ -n "${WINGET_GITHUB_TOKEN:-}" ]] || fail "WINGET_GITHUB_TOKEN is required"
for manifest in "${MANIFESTS[@]}"; do
	[[ -f "$WINGET_MANIFESTS/$manifest" ]] || fail "missing $WINGET_MANIFESTS/$manifest"
	grep -qx "PackageVersion: $VERSION" "$WINGET_MANIFESTS/$manifest" ||
		fail "$manifest is not for version $VERSION"
done

export GH_TOKEN="$WINGET_GITHUB_TOKEN"
VERSION_DIR="$PACKAGE_DIR/$VERSION"
BRANCH="$PACKAGE_ID-$VERSION"

# exists <api path>: 0 when GitHub answers 200, 1 when it answers 404. Any
# other answer is asked again, and then stops the script: an outage must not
# read as "not published yet".
exists() {
	local out status attempt=1
	while true; do
		status=0
		out="$(gh api "$1" 2>&1)" || status=$?
		if ((status == 0)); then
			return 0
		fi
		if grep -q "HTTP 404" <<<"$out"; then
			return 1
		fi
		if ((attempt >= 4)); then
			fail "could not ask GitHub for $1: $out"
		fi
		echo "Asking GitHub for $1 failed (attempt $attempt of 4); asking again. GitHub said: $out" >&2
		sleep $((attempt * ${WINGET_RETRY_DELAY_SECONDS:-15}))
		attempt=$((attempt + 1))
	done
}

if exists "repos/$UPSTREAM/contents/$VERSION_DIR?ref=$UPSTREAM_BRANCH"; then
	echo "$UPSTREAM already has $PACKAGE_ID $VERSION; nothing to do."
	exit 0
fi

OWNER="${WINGET_FORK_OWNER:-$(gh api user --jq .login)}"
FORK="$OWNER/winget-pkgs"

open_pull_request="$(gh api "repos/$UPSTREAM/pulls?state=open&head=$OWNER:$BRANCH" --jq '.[0].html_url // empty')"
if [[ -n "$open_pull_request" ]]; then
	echo "$PACKAGE_ID $VERSION is already waiting in $open_pull_request; nothing to do."
	exit 0
fi

exists "repos/$FORK" ||
	fail "$FORK does not exist: fork $UPSTREAM into $OWNER first (see the setup in Scripts/PackageManagers/README.md)"
[[ "$(gh api "repos/$FORK" --jq '.parent.full_name // empty')" == "$UPSTREAM" ]] ||
	fail "$FORK is not a fork of $UPSTREAM"

if exists "repos/$UPSTREAM/contents/$PACKAGE_DIR?ref=$UPSTREAM_BRANCH"; then
	TITLE="New version: $PACKAGE_ID version $VERSION"
else
	TITLE="New package: $PACKAGE_ID version $VERSION"
fi

# The branch, at winget-pkgs' newest commit. One left by a run that stopped
# before its pull request is moved there too, so it carries only this commit.
BASE="$(gh api "repos/$UPSTREAM/git/ref/heads/$UPSTREAM_BRANCH" --jq .object.sha)"
if exists "repos/$FORK/git/ref/heads/$BRANCH"; then
	gh api --method PATCH "repos/$FORK/git/refs/heads/$BRANCH" \
		-f sha="$BASE" -F force=true >/dev/null
else
	gh api --method POST "repos/$FORK/git/refs" \
		-f ref="refs/heads/$BRANCH" -f sha="$BASE" >/dev/null
fi

for manifest in "${MANIFESTS[@]}"; do
	gh api --method PUT "repos/$FORK/contents/$VERSION_DIR/$manifest" \
		-f message="$TITLE" \
		-f branch="$BRANCH" \
		-f content="$(base64 <"$WINGET_MANIFESTS/$manifest" | tr -d '\n')" >/dev/null
done

PULL_REQUEST="$(gh api --method POST "repos/$UPSTREAM/pulls" \
	-f title="$TITLE" \
	-f head="$OWNER:$BRANCH" \
	-f base="$UPSTREAM_BRANCH" \
	-f body="$PACKAGE_ID $VERSION, released at https://github.com/OneUptime/oneuptime/releases/tag/$VERSION. The manifests are generated by GoReleaser in OneUptime's release workflow." \
	--jq .html_url)"

echo "Opened $PULL_REQUEST"
