#!/usr/bin/env bash
#
# Commits one release's Homebrew cask for the OneUptime infrastructure agent
# to the OneUptime/homebrew-tap repository, for
#
#   brew install oneuptime/tap/oneuptime-infrastructure-agent
#
# GoReleaser writes the cask (agents/InfrastructureAgent/.goreleaser.yaml,
# homebrew_casks) in infrastructure-agent-build; release.yml's
# publish-infrastructure-agent-homebrew job runs this once the GitHub release
# the cask downloads from is published. Environment:
#
#   PACKAGE_VERSION           the release's version
#   CASK_FILE                 the cask GoReleaser wrote for it
#   HOMEBREW_TAP_DEPLOY_KEY   private key of a deploy key with write access to
#                             OneUptime/homebrew-tap
#
# and, to publish somewhere else (Tests/Ops does):
#
#   HOMEBREW_TAP_REPOSITORY   git@github.com:OneUptime/homebrew-tap.git
#   HOMEBREW_TAP_BRANCH       main
#
# A tap holds one version of a cask, the one `brew upgrade` installs. So a
# tap that already has this version, or a newer one (a re-run of an older
# release's job), is left as it is.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=GitHubDeployKey.sh
source "$SCRIPT_DIR/GitHubDeployKey.sh"

VERSION="${PACKAGE_VERSION:-}"
REPOSITORY="${HOMEBREW_TAP_REPOSITORY:-git@github.com:OneUptime/homebrew-tap.git}"
BRANCH="${HOMEBREW_TAP_BRANCH:-main}"

fail() {
	echo "PublishHomebrewCask: $*" >&2
	exit 1
}

# The version line of a cask file, as GoReleaser writes it.
cask_version() {
	sed -n 's/^  version "\(.*\)"$/\1/p' "$1" | head -n 1
}

[[ -n "$VERSION" ]] || fail "PACKAGE_VERSION is required"
[[ -f "${CASK_FILE:-}" ]] || fail "CASK_FILE must be a file: '${CASK_FILE:-}'"
[[ -n "${HOMEBREW_TAP_DEPLOY_KEY:-}" ]] || fail "HOMEBREW_TAP_DEPLOY_KEY is required"
[[ "$(cask_version "$CASK_FILE")" == "$VERSION" ]] ||
	fail "$CASK_FILE is for version '$(cask_version "$CASK_FILE")', not $VERSION"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

use_github_deploy_key "$HOMEBREW_TAP_DEPLOY_KEY" "$WORK"

TAP="$WORK/tap"
status=0
git ls-remote --exit-code --heads "$REPOSITORY" "$BRANCH" >/dev/null || status=$?
case "$status" in
0)
	git clone --quiet --depth 1 --branch "$BRANCH" "$REPOSITORY" "$TAP"
	;;
2)
	echo "$REPOSITORY has no $BRANCH branch yet; this is the tap's first commit."
	git init --quiet "$TAP"
	git -C "$TAP" checkout --quiet -b "$BRANCH"
	git -C "$TAP" remote add origin "$REPOSITORY"
	;;
*)
	fail "could not read $REPOSITORY (git ls-remote exited $status)"
	;;
esac

TARGET="$TAP/Casks/$(basename "$CASK_FILE")"
if [[ -f "$TARGET" ]]; then
	current="$(cask_version "$TARGET")"
	if [[ "$current" == "$VERSION" ]]; then
		echo "The tap already has $(basename "$CASK_FILE" .rb) $VERSION; nothing to do."
		exit 0
	fi
	newest="$(printf '%s\n%s\n' "$current" "$VERSION" | sort --version-sort | tail -n 1)"
	if [[ "$newest" == "$current" ]]; then
		echo "The tap has $(basename "$CASK_FILE" .rb) $current, newer than $VERSION; leaving it."
		exit 0
	fi
fi

mkdir -p "$TAP/Casks"
cp "$CASK_FILE" "$TARGET"
git -C "$TAP" add "Casks/$(basename "$CASK_FILE")"
git -C "$TAP" -c user.name="Continuous Integration" -c user.email="hello@oneuptime.com" \
	-c commit.gpgsign=false commit --quiet -m "$(basename "$CASK_FILE" .rb) $VERSION"
git -C "$TAP" push --quiet origin "HEAD:refs/heads/$BRANCH"

echo "Published $(basename "$CASK_FILE" .rb) $VERSION to $REPOSITORY."
