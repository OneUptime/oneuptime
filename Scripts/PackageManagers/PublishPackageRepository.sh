#!/usr/bin/env bash
#
# Publishes one release of the OneUptime infrastructure agent to
# packages.oneuptime.com, the GitHub Pages site of OneUptime/packages: clones
# the site, adds the release with BuildPackageRepository.sh, and pushes it.
#
# release.yml's publish-infrastructure-agent-apt-yum job runs it once the
# GitHub release is published. Environment:
#
#   PACKAGE_VERSION                the release's version
#   PACKAGES_DIR                   its .deb and .rpm packages (the
#                                  release-infrastructure-agent artifact)
#   PACKAGE_REPOSITORY_DEPLOY_KEY  private key of a deploy key with write
#                                  access to OneUptime/packages
#   GPG_PRIVATE_KEY                the release signing key (key@oneuptime.com),
#                                  the secret the Helm chart and Terraform
#                                  provider are signed with
#
# and, to publish somewhere else (Tests/Ops/package-repository-e2e.sh does):
#
#   PACKAGE_REPOSITORY             git@github.com:OneUptime/packages.git
#   PACKAGE_REPOSITORY_BRANCH      main
#   PACKAGE_REPOSITORY_URL         https://packages.oneuptime.com
#   PACKAGE_SIGNING_KEY            key@oneuptime.com
#
# The site is pushed as one commit with no parent, in place of the last one.
# GitHub Pages serves only the newest tree, and history would keep every
# package ever published, about 14 MB a release, in a repository GitHub
# wants kept small. The push is --force-with-lease against the commit this
# run cloned, so it never replaces one it did not start from. A version the
# site already has changes nothing, and then nothing is pushed.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=GitHubDeployKey.sh
source "$SCRIPT_DIR/GitHubDeployKey.sh"

VERSION="${PACKAGE_VERSION:-}"
REPOSITORY="${PACKAGE_REPOSITORY:-git@github.com:OneUptime/packages.git}"
BRANCH="${PACKAGE_REPOSITORY_BRANCH:-main}"
URL="${PACKAGE_REPOSITORY_URL:-https://packages.oneuptime.com}"
SIGNING_KEY="${PACKAGE_SIGNING_KEY:-key@oneuptime.com}"

fail() {
	echo "PublishPackageRepository: $*" >&2
	exit 1
}

[[ -n "$VERSION" ]] || fail "PACKAGE_VERSION is required"
[[ -d "${PACKAGES_DIR:-}" ]] || fail "PACKAGES_DIR must be a directory"
[[ -n "${PACKAGE_REPOSITORY_DEPLOY_KEY:-}" ]] || fail "PACKAGE_REPOSITORY_DEPLOY_KEY is required"
[[ -n "${GPG_PRIVATE_KEY:-}" ]] || fail "GPG_PRIVATE_KEY is required"

WORK="$(mktemp -d)"
cleanup() {
	gpgconf --kill gpg-agent >/dev/null 2>&1 || true
	rm -rf "$WORK"
}
trap cleanup EXIT

# The signing key, in a keyring of this run's own.
#
# %b, because the stored secret carries literal \n sequences in place of
# newlines (see release.yml's publish-terraform-provider). gpg's exit code is
# not the gate: a stray armor line in the secret fails an import that still
# imported the key. The gate is the secret key being there afterwards.
export GNUPGHOME="$WORK/gnupg"
mkdir -m 700 "$GNUPGHOME"
printf '%b\n' "$GPG_PRIVATE_KEY" >"$WORK/signing.key"
gpg --batch --quiet --import "$WORK/signing.key" 2>/dev/null || true
rm -f "$WORK/signing.key"
gpg --batch --list-secret-keys "$SIGNING_KEY" >/dev/null 2>&1 ||
	fail "GPG_PRIVATE_KEY holds no secret key for $SIGNING_KEY"

use_github_deploy_key "$PACKAGE_REPOSITORY_DEPLOY_KEY" "$WORK"

# The site as it is now. A repository with no branch yet is the first
# publish; any other failure to read it stops here.
SITE="$WORK/site"
status=0
git ls-remote --exit-code --heads "$REPOSITORY" "$BRANCH" >/dev/null || status=$?
case "$status" in
0)
	git clone --quiet --depth 1 --branch "$BRANCH" "$REPOSITORY" "$SITE"
	BASE="$(git -C "$SITE" rev-parse HEAD)"
	;;
2)
	echo "$REPOSITORY has no $BRANCH branch yet; publishing the site's first commit."
	git init --quiet "$SITE"
	git -C "$SITE" remote add origin "$REPOSITORY"
	BASE=""
	;;
*)
	fail "could not read $REPOSITORY (git ls-remote exited $status)"
	;;
esac

bash "$SCRIPT_DIR/BuildPackageRepository.sh" \
	--repository "$SITE" \
	--packages "$PACKAGES_DIR" \
	--version "$VERSION" \
	--signing-key "$SIGNING_KEY" \
	--base-url "$URL"

# For GitHub Pages: serve the files as they are, without a Jekyll build, and
# keep the custom domain, which Pages reads from CNAME on the branch.
touch "$SITE/.nojekyll"
host="${URL#https://}"
host="${host%%/*}"
if [[ "$URL" == https://* && "$host" != *.github.io ]]; then
	printf '%s\n' "$host" >"$SITE/CNAME"
fi

if [[ -z "$(git -C "$SITE" status --porcelain)" ]]; then
	echo "Nothing on the site changed; nothing to push."
	exit 0
fi

git -C "$SITE" checkout --quiet --orphan "publish-$VERSION"
git -C "$SITE" add --all
git -C "$SITE" -c user.name="Continuous Integration" -c user.email="hello@oneuptime.com" \
	-c commit.gpgsign=false commit --quiet -m "oneuptime-infrastructure-agent $VERSION"
git -C "$SITE" push --quiet --force-with-lease="refs/heads/$BRANCH:$BASE" \
	origin "HEAD:refs/heads/$BRANCH"

echo "Published oneuptime-infrastructure-agent $VERSION to $URL."
