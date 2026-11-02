#!/usr/bin/env bash
#
# Publishes the coding agent plugin to its own repository, where Cursor's
# Marketplace and the Claude directory read it: the folder
# Scripts/MCP/BuildCodingAgentPlugin.js builds from
# packages/App/FeatureSet/MCP/CodingAgentPlugin, at this release's version.
# The repository is the one the package's plugin.json names. release.yml's
# publish-coding-agent-plugin job runs this once the GitHub release is
# published. Environment:
#
#   PACKAGE_VERSION                 the release's version
#   CODING_AGENT_PLUGIN_DEPLOY_KEY  private key of a deploy key with write
#                                   access to the plugin's repository
#
# and, to publish somewhere else (Tests/Ops does):
#
#   CODING_AGENT_PLUGIN_REPOSITORY  git@github.com:<the repository plugin.json names>.git
#   CODING_AGENT_PLUGIN_BRANCH      main
#
# Both directories look at every commit: the Claude directory scans each one,
# and Cursor reviews each update by hand. So a release that would change
# nothing but the version pushes nothing. The plugin is built first at the
# version the repository has, and only if that differs from what is there is
# it built at this release's version and pushed. A repository at a newer
# version, from a re-run of an older release's job, is left as it is.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
# shellcheck source=../PackageManagers/GitHubDeployKey.sh
source "$REPO_ROOT/Scripts/PackageManagers/GitHubDeployKey.sh"

BUILD="$SCRIPT_DIR/BuildCodingAgentPlugin.js"
OWN_FIELDS="$REPO_ROOT/packages/App/FeatureSet/MCP/CodingAgentPlugin/plugin.json"

fail() {
	echo "PublishCodingAgentPlugin: $*" >&2
	exit 1
}

# git@github.com:<owner>/<name>.git, from the https URL plugin.json names.
repository_from_package() {
	local url
	url="$(node -p 'require(process.argv[1]).repository' "$OWN_FIELDS")"
	[[ "$url" =~ ^https://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)$ ]] ||
		fail "$OWN_FIELDS names no GitHub repository: '$url'"
	echo "git@github.com:${BASH_REMATCH[1]}.git"
}

# The version of the plugin in a clone, or nothing when it has none yet.
published_version() {
	local manifest="$1/.claude-plugin/plugin.json"
	if [[ -f "$manifest" ]]; then
		node -p 'require(process.argv[1]).version' "$manifest"
	fi
}

VERSION="${PACKAGE_VERSION:-}"
BRANCH="${CODING_AGENT_PLUGIN_BRANCH:-main}"

[[ -n "$VERSION" ]] || fail "PACKAGE_VERSION is required"
[[ -n "${CODING_AGENT_PLUGIN_DEPLOY_KEY:-}" ]] || fail "CODING_AGENT_PLUGIN_DEPLOY_KEY is required"

REPOSITORY="${CODING_AGENT_PLUGIN_REPOSITORY:-$(repository_from_package)}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

use_github_deploy_key "$CODING_AGENT_PLUGIN_DEPLOY_KEY" "$WORK"

PLUGIN="$WORK/oneuptime"
status=0
git ls-remote --exit-code --heads "$REPOSITORY" "$BRANCH" >/dev/null || status=$?
case "$status" in
0)
	git clone --quiet --depth 1 --branch "$BRANCH" "$REPOSITORY" "$PLUGIN"
	;;
2)
	echo "$REPOSITORY has no $BRANCH branch yet; this is the plugin's first commit."
	git init --quiet "$PLUGIN"
	git -C "$PLUGIN" checkout --quiet -b "$BRANCH"
	git -C "$PLUGIN" remote add origin "$REPOSITORY"
	;;
*)
	fail "could not read $REPOSITORY (git ls-remote exited $status)"
	;;
esac

published="$(published_version "$PLUGIN")"

if [[ -n "$published" ]]; then
	newest="$(printf '%s\n%s\n' "$published" "$VERSION" | sort --version-sort | tail -n 1)"
	if [[ "$published" != "$VERSION" && "$newest" == "$published" ]]; then
		echo "The plugin's repository is at $published, newer than $VERSION; leaving it."
		exit 0
	fi

	# What this release would publish, at the version the repository has.
	node "$BUILD" --version "$published" "$PLUGIN" >/dev/null
	if [[ -z "$(git -C "$PLUGIN" status --porcelain)" ]]; then
		echo "Nothing in the plugin changed since $published, so nothing is published for $VERSION."
		exit 0
	fi
fi

node "$BUILD" --version "$VERSION" "$PLUGIN" >/dev/null
git -C "$PLUGIN" add --all
git -C "$PLUGIN" -c user.name="Continuous Integration" -c user.email="hello@oneuptime.com" \
	-c commit.gpgsign=false commit --quiet -m "OneUptime plugin $VERSION" \
	-m "Built by OneUptime/oneuptime's release $VERSION, from packages/App/FeatureSet/MCP/CodingAgentPlugin. Change the plugin there: this repository is replaced at each release that changes it."
git -C "$PLUGIN" push --quiet origin "HEAD:refs/heads/$BRANCH"

echo "Published the plugin $VERSION to $REPOSITORY."
