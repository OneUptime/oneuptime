#!/usr/bin/env bash
#
# The infrastructure agent's apt and yum repository (packages.oneuptime.com),
# end to end. Scripts/PackageManagers/PublishPackageRepository.sh publishes
# two releases of a stand-in agent package, built by nfpm as GoReleaser
# builds the real one, to a git repository standing in for OneUptime/packages.
# The site it pushes is served over HTTP, and the install commands of the
# Server / VM Monitor page (packages/App/FeatureSet/Docs/Content/en/monitor/
# server-monitor.md, the Linux tab of "Install the agent") run as written on
# Ubuntu (apt) and Rocky Linux 8 (dnf), under a root umask of 077, with only
# https://packages.oneuptime.com swapped for that server.
#
# InfrastructureAgentPackageManagers.test.js reads the scripts and the job;
# this shows what only the real tools can:
#
#   - apt verifies InRelease against gpg.key, fetches the indexes by hash,
#     installs the newest version, goes back to the older one and forward
#     again; and refuses the repository when gpg.key is another key;
#   - dnf, on RHEL 8's rpm, verifies repomd.xml and every package's
#     signature (repo_gpgcheck, gpgcheck), installs, downgrades and upgrades;
#   - the publish reads the signing key with its newlines written as \n, as
#     the GPG_PRIVATE_KEY secret holds it; publishes the first release to an
#     empty repository; pushes nothing for a version the site already has;
#     and replaces the site's one commit with another, with no parent, for
#     the next release, without a CNAME for a site that is not on https.
#
# Needs docker and network access to the distributions' package mirrors. Not
# part of `npm test`; the "Ops Config Test" workflow runs it on every PR.
#
# Usage: bash Tests/Ops/package-repository-e2e.sh [--apt-image IMAGE]
#            [--dnf-image IMAGE] [--builder-image IMAGE] [--server-image IMAGE]
#   apt and the builder default to public.ecr.aws/docker/library/ubuntu:24.04
#   (the builder runs on the Ubuntu release.yml's job runs on), dnf to
#   public.ecr.aws/docker/library/rockylinux:8: the images the workflow warms.

set -euo pipefail

APT_IMAGE="public.ecr.aws/docker/library/ubuntu:24.04"
DNF_IMAGE="public.ecr.aws/docker/library/rockylinux:8"
BUILDER_IMAGE="public.ecr.aws/docker/library/ubuntu:24.04"
SERVER_IMAGE="public.ecr.aws/docker/library/busybox:1.37"
# nfpm is what GoReleaser builds the agent's .deb and .rpm with.
NFPM_IMAGE="ghcr.io/goreleaser/nfpm:v2.43.1"

while [ $# -gt 0 ]; do
	case "$1" in
	--apt-image) APT_IMAGE="${2:?--apt-image needs a value}" ;;
	--dnf-image) DNF_IMAGE="${2:?--dnf-image needs a value}" ;;
	--builder-image) BUILDER_IMAGE="${2:?--builder-image needs a value}" ;;
	--server-image) SERVER_IMAGE="${2:?--server-image needs a value}" ;;
	*)
		echo "Unknown argument: $1" >&2
		exit 2
		;;
	esac
	shift 2
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCS_PAGE="$REPO_ROOT/packages/App/FeatureSet/Docs/Content/en/monitor/server-monitor.md"
RUN_ID="package-repository-e2e-$$"
SITE_URL="https://packages.oneuptime.com"
TEST_URL="http://repo:8000"

WORK="$(mktemp -d)"
chmod 755 "$WORK"

cleanup() {
	docker rm -f "$RUN_ID-server" >/dev/null 2>&1 || true
	docker network rm "$RUN_ID" >/dev/null 2>&1 || true
	# The containers wrote as root.
	docker run --rm -v "$WORK:/work" "$BUILDER_IMAGE" sh -c 'rm -rf /work/* /work/.[!.]*' >/dev/null 2>&1 || true
	docker image rm "$RUN_ID-builder" >/dev/null 2>&1 || true
	rm -rf "$WORK"
}
trap cleanup EXIT

fail() {
	echo "FAIL: $*" >&2
	exit 1
}

# ─── The docs' commands ──────────────────────────────────────────────────

# The page's fenced bash block that contains $1.
docs_block() {
	awk -v needle="$1" '
		/^```bash/ { inside = 1; block = ""; next }
		/^```/ && inside { inside = 0; if (index(block, needle)) { printf "%s", block; exit } next }
		inside { block = block $0 "\n" }
	' "$DOCS_PAGE"
}

for family in apt dnf; do
	case "$family" in
	apt) block="$(docs_block 'apt-get install oneuptime-infrastructure-agent')" ;;
	dnf) block="$(docs_block 'dnf install oneuptime-infrastructure-agent')" ;;
	esac
	[ -n "$block" ] || fail "the docs page has no $family install block"
	grep -qF "$SITE_URL" <<<"$block" || fail "the docs' $family block does not use $SITE_URL"
	printf '%s\n' "${block//$SITE_URL/$TEST_URL}" >"$WORK/$family-commands.sh"
done

# ─── Two releases of a stand-in package ──────────────────────────────────

mkdir -p "$WORK/nfpm"
for version in 1.0.0 1.0.1; do
	mkdir -p "$WORK/packages-$version"
	printf '#!/bin/sh\necho "oneuptime-infrastructure-agent %s"\n' "$version" >"$WORK/nfpm/agent"
	chmod 755 "$WORK/nfpm/agent"
	for arch in amd64 arm64; do
		cat >"$WORK/nfpm/nfpm.yaml" <<EOF
name: oneuptime-infrastructure-agent
arch: $arch
version: $version
maintainer: OneUptime <hello@oneuptime.com>
description: Stand-in for the OneUptime infrastructure agent
license: Apache-2.0
contents:
  - src: /nfpm/agent
    dst: /usr/bin/oneuptime-infrastructure-agent
    file_info:
      mode: 0755
EOF
		for format in deb rpm; do
			docker run --rm -v "$WORK/nfpm:/nfpm" -v "$WORK/packages-$version:/out" "$NFPM_IMAGE" \
				package --config /nfpm/nfpm.yaml --packager "$format" \
				--target "/out/oneuptime-infrastructure-agent_$arch.$format" >/dev/null
		done
	done
done

# ─── Publish them as release.yml's job does ──────────────────────────────

docker build --quiet --tag "$RUN_ID-builder" - >/dev/null <<EOF
FROM $BUILDER_IMAGE
RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      apt-utils createrepo-c rpm gnupg git openssh-client ca-certificates \
 && rm -rf /var/lib/apt/lists/*
EOF

cat >"$WORK/publish.sh" <<'EOF'
set -euo pipefail
fail() { echo "FAIL: $*" >&2; exit 1; }

export GNUPGHOME=/tmp/keys
mkdir -m 700 "$GNUPGHOME"
gpg --batch --quiet --passphrase '' --quick-generate-key 'Package repository e2e <key@oneuptime.com>' rsa3072 sign never
gpg --batch --quiet --passphrase '' --quick-generate-key 'Someone else <someone@example.com>' rsa3072 sign never
gpg --batch --armor --export someone@example.com >/work/other.key
# On one line, its newlines written as \n, as the GPG_PRIVATE_KEY secret holds it.
GPG_PRIVATE_KEY="$(gpg --batch --armor --export-secret-keys key@oneuptime.com | sed -e ':a' -e 'N' -e '$!ba' -e 's/\n/\\n/g')"
export GPG_PRIVATE_KEY
unset GNUPGHOME

git init --quiet --bare --initial-branch=main /work/packages.git

publish() {
	PACKAGE_VERSION="$1" PACKAGES_DIR="/work/packages-$1" \
		PACKAGE_REPOSITORY=/work/packages.git PACKAGE_REPOSITORY_URL=http://repo:8000 \
		PACKAGE_REPOSITORY_DEPLOY_KEY="unused: the repository is a path" \
		bash /scripts/PublishPackageRepository.sh
}
site_commit() {
	git --git-dir=/work/packages.git rev-parse --verify --quiet refs/heads/main || true
}

publish 1.0.0
first="$(site_commit)"
[ -n "$first" ] || fail "the first release pushed nothing"

publish 1.0.0
[ "$(site_commit)" = "$first" ] || fail "publishing 1.0.0 again pushed a commit"

publish 1.0.1
[ "$(site_commit)" != "$first" ] || fail "1.0.1 pushed nothing"
[ "$(git --git-dir=/work/packages.git rev-list --count refs/heads/main)" = 1 ] ||
	fail "the site's commit has a parent"

git clone --quiet /work/packages.git /work/site
for file in \
	deb/pool/main/o/oneuptime-infrastructure-agent/oneuptime-infrastructure-agent_1.0.0_amd64.deb \
	deb/pool/main/o/oneuptime-infrastructure-agent/oneuptime-infrastructure-agent_1.0.1_arm64.deb \
	rpm/Packages/oneuptime-infrastructure-agent-1.0.0-1.x86_64.rpm \
	rpm/Packages/oneuptime-infrastructure-agent-1.0.1-1.aarch64.rpm \
	deb/dists/stable/InRelease rpm/repodata/repomd.xml.asc rpm/oneuptime.repo gpg.key .nojekyll; do
	[ -e "/work/site/$file" ] || fail "the site has no $file"
done
[ ! -e /work/site/CNAME ] || fail "a site on http got a CNAME"
grep -qx 'baseurl=http://repo:8000/rpm' /work/site/rpm/oneuptime.repo || fail "oneuptime.repo names another site"
echo "Published 1.0.0 and 1.0.1."
EOF

docker run --rm -v "$WORK:/work" -v "$REPO_ROOT/Scripts/PackageManagers:/scripts:ro" \
	"$RUN_ID-builder" bash /work/publish.sh

# ─── Install from it, as the docs say ────────────────────────────────────

docker network create "$RUN_ID" >/dev/null
docker run -d --name "$RUN_ID-server" --network "$RUN_ID" --network-alias repo \
	-v "$WORK/site:/site:ro" "$SERVER_IMAGE" httpd -f -vv -p 8000 -h /site >/dev/null

cat >"$WORK/client-setup.sh" <<'EOF'
# What a sudo user's shell has, for the docs' commands: sudo, and a umask
# that leaves new files readable by root alone, as on a hardened server.
printf '#!/bin/sh\nexec "$@"\n' >/usr/local/bin/sudo
chmod 755 /usr/local/bin/sudo
umask 077
EOF

cat >"$WORK/apt-client.sh" <<'EOF'
set -euo pipefail
fail() { echo "FAIL: $*" >&2; exit 1; }
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends curl ca-certificates >/dev/null
echo 'APT::Get::Assume-Yes "true";' >/etc/apt/apt.conf.d/90assume-yes
. /work/client-setup.sh

echo "--- the docs' apt commands"
cat /work/apt-commands.sh
bash -euo pipefail /work/apt-commands.sh

installed() { dpkg-query --show --showformat '${Version}' oneuptime-infrastructure-agent; }
[ "$(installed)" = 1.0.1 ] || fail "apt installed $(installed), not the newest, 1.0.1"
[ "$(oneuptime-infrastructure-agent)" = "oneuptime-infrastructure-agent 1.0.1" ] || fail "the installed agent is not 1.0.1"
apt-get install -qq --allow-downgrades oneuptime-infrastructure-agent=1.0.0 >/dev/null
[ "$(installed)" = 1.0.0 ] || fail "apt did not go back to 1.0.0"
apt-get install -qq --only-upgrade oneuptime-infrastructure-agent >/dev/null
[ "$(installed)" = 1.0.1 ] || fail "apt did not upgrade to 1.0.1"

# Signed by a key other than gpg.key: apt refuses the repository.
cp /work/other.key /etc/apt/keyrings/oneuptime.asc
chmod a+r /etc/apt/keyrings/oneuptime.asc
rm -rf /var/lib/apt/lists/*
if apt-get update >/tmp/update.log 2>&1; then
	cat /tmp/update.log
	fail "apt accepted the repository with another key"
fi
grep -q 'NO_PUBKEY' /tmp/update.log || { cat /tmp/update.log; fail "apt refused the repository, but not for its signature"; }
echo "apt: installed 1.0.1, went back to 1.0.0 and forward again, and refused another key."
EOF

cat >"$WORK/dnf-client.sh" <<'EOF'
set -euo pipefail
fail() { echo "FAIL: $*" >&2; exit 1; }
echo 'assumeyes=1' >>/etc/dnf/dnf.conf
. /work/client-setup.sh

echo "--- the docs' dnf commands"
cat /work/dnf-commands.sh
bash -euo pipefail /work/dnf-commands.sh

installed() { rpm --query --queryformat '%{VERSION}' oneuptime-infrastructure-agent; }
[ "$(installed)" = 1.0.1 ] || fail "dnf installed $(installed), not the newest, 1.0.1"
grep -qx 'gpgcheck=1' /etc/yum.repos.d/oneuptime.repo || fail "oneuptime.repo does not check package signatures"
grep -qx 'repo_gpgcheck=1' /etc/yum.repos.d/oneuptime.repo || fail "oneuptime.repo does not check its metadata's signature"
rpm --query gpg-pubkey --queryformat '%{SUMMARY}\n' | grep -q 'key@oneuptime.com' || fail "dnf imported no OneUptime key"
dnf downgrade -q oneuptime-infrastructure-agent-1.0.0 >/dev/null
[ "$(installed)" = 1.0.0 ] || fail "dnf did not go back to 1.0.0"
dnf upgrade -q oneuptime-infrastructure-agent >/dev/null
[ "$(installed)" = 1.0.1 ] || fail "dnf did not upgrade to 1.0.1"
echo "dnf: installed 1.0.1, checked its signatures, went back to 1.0.0 and forward again."
EOF

docker run --rm --network "$RUN_ID" -v "$WORK:/work:ro" "$APT_IMAGE" bash /work/apt-client.sh
docker logs "$RUN_ID-server" 2>&1 | grep -q '/deb/dists/stable/main/binary-[a-z0-9]*/by-hash/SHA256/' ||
	fail "apt did not fetch the indexes by hash"

docker run --rm --network "$RUN_ID" -v "$WORK:/work:ro" "$DNF_IMAGE" bash /work/dnf-client.sh

echo "PASS: the infrastructure agent's apt and yum repository installs as the docs say."
