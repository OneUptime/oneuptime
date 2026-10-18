#!/usr/bin/env bash
#
# Adds one release of the OneUptime infrastructure agent to a signed apt and
# yum repository: a directory any web server can serve as it is
# (packages.oneuptime.com serves it from GitHub Pages, see
# PublishPackageRepository.sh).
#
#   gpg.key        the public key everything below is signed with
#   index.html     how to add the repositories, for whoever opens the site
#   deb/           apt: dists/stable/{InRelease,Release,Release.gpg} and
#                  dists/stable/main/binary-<arch>/Packages(.gz), over
#                  pool/main/o/oneuptime-infrastructure-agent/*.deb
#   rpm/           yum and dnf: oneuptime.repo, Packages/*.rpm (each signed),
#                  repodata/ (repomd.xml signed in repomd.xml.asc)
#
# Usage:
#   BuildPackageRepository.sh --repository <dir> --packages <dir> --version <x.y.z>
#       [--signing-key <gpg key id>] [--keep <versions>] [--base-url <url>]
#
# --packages holds the release's oneuptime-infrastructure-agent_<arch>.deb and
# .rpm for amd64 and arm64: what release.yml's release-infrastructure-agent
# artifact holds. Each must carry --version, which is how a package with the
# GoReleaser snapshot version in it (14.0.71~SNAPSHOT-<commit>) is kept out.
#
# The signing key must be in gpg's keyring (GNUPGHOME). A key with a
# passphrase needs it in GPG_PASSPHRASE.
#
# A version the repository already has is left as it is, so running a
# release's job again publishes nothing twice. The newest --keep versions
# (10 by default) are kept; older ones are removed.
#
# Needs dpkg-deb, apt-ftparchive (apt-utils), createrepo_c (createrepo-c),
# rpm, rpmsign, gpg, gzip and sha256sum: on Ubuntu,
#   apt-get install apt-utils createrepo-c rpm gnupg

set -euo pipefail

readonly PACKAGE="oneuptime-infrastructure-agent"
readonly ARCHES=(amd64 arm64)
readonly SUITE="stable"
readonly COMPONENT="main"

REPOSITORY=""
PACKAGES=""
VERSION=""
SIGNING_KEY="key@oneuptime.com"
KEEP=10
BASE_URL="https://packages.oneuptime.com"

fail() {
	echo "BuildPackageRepository: $*" >&2
	exit 1
}

while (($# > 0)); do
	case "$1" in
	--repository) REPOSITORY="${2:-}" ;;
	--packages) PACKAGES="${2:-}" ;;
	--version) VERSION="${2:-}" ;;
	--signing-key) SIGNING_KEY="${2:-}" ;;
	--keep) KEEP="${2:-}" ;;
	--base-url) BASE_URL="${2:-}" ;;
	*) fail "unknown argument: $1" ;;
	esac
	shift 2
done

[[ -n "$REPOSITORY" ]] || fail "--repository is required"
[[ -d "$PACKAGES" ]] || fail "--packages must be a directory: '$PACKAGES'"
[[ "$VERSION" =~ ^[0-9]+(\.[0-9]+)+$ ]] ||
	fail "--version must be numbers separated by dots, not '$VERSION'"
[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || fail "--keep must be a positive number"
[[ -n "$SIGNING_KEY" ]] || fail "--signing-key must not be empty"
BASE_URL="${BASE_URL%/}"

for tool in dpkg-deb apt-ftparchive createrepo_c rpm rpmsign rpmkeys gpg gzip sha256sum; do
	command -v "$tool" >/dev/null || fail "$tool is not installed"
done

mkdir -p "$REPOSITORY"
REPOSITORY="$(cd "$REPOSITORY" && pwd)"
DEB="$REPOSITORY/deb"
RPM="$REPOSITORY/rpm"
POOL="$DEB/pool/$COMPONENT/${PACKAGE:0:1}/$PACKAGE"
DISTS="$DEB/dists/$SUITE"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

GPG=(gpg --batch --yes --local-user "$SIGNING_KEY" --digest-algo SHA256)
RPMSIGN_EXTRA="--batch"
if [[ -n "${GPG_PASSPHRASE:-}" ]]; then
	printf '%s' "$GPG_PASSPHRASE" >"$WORK/passphrase"
	GPG+=(--pinentry-mode loopback --passphrase-file "$WORK/passphrase")
	RPMSIGN_EXTRA="--batch --pinentry-mode loopback --passphrase-file $WORK/passphrase"
fi
RPMSIGN=(rpmsign --addsign
	--define "__gpg $(command -v gpg)"
	--define "_gpg_name $SIGNING_KEY"
	--define "_gpg_sign_cmd_extra_args $RPMSIGN_EXTRA")
if [[ -n "${GNUPGHOME:-}" ]]; then
	RPMSIGN+=(--define "_gpg_path $GNUPGHOME")
fi

gpg --batch --list-secret-keys "$SIGNING_KEY" >/dev/null 2>&1 ||
	fail "gpg has no secret key for '$SIGNING_KEY'"

rpm_arch() {
	case "$1" in
	amd64) echo x86_64 ;;
	arm64) echo aarch64 ;;
	esac
}

# ─── The release's packages, checked before anything is written ──────────

declare -A DEB_TARGET RPM_TARGET RPM_SOURCE
for arch in "${ARCHES[@]}"; do
	deb="$PACKAGES/${PACKAGE}_${arch}.deb"
	rpm_file="$PACKAGES/${PACKAGE}_${arch}.rpm"
	[[ -f "$deb" ]] || fail "missing $deb"
	[[ -f "$rpm_file" ]] || fail "missing $rpm_file"

	# shellcheck disable=SC2016 # dpkg-deb's own ${Field} syntax, not the shell's
	read -r name version architecture < <(dpkg-deb --show --showformat '${Package} ${Version} ${Architecture}\n' "$deb")
	[[ "$name $version $architecture" == "$PACKAGE $VERSION $arch" ]] ||
		fail "$deb is '$name $version $architecture', not '$PACKAGE $VERSION $arch'"

	read -r name version release architecture < <(rpm --query --package --queryformat '%{NAME} %{VERSION} %{RELEASE} %{ARCH}\n' "$rpm_file" 2>/dev/null)
	[[ "$name $version $architecture" == "$PACKAGE $VERSION $(rpm_arch "$arch")" ]] ||
		fail "$rpm_file is '$name $version $architecture', not '$PACKAGE $VERSION $(rpm_arch "$arch")'"

	DEB_TARGET[$arch]="$POOL/${PACKAGE}_${VERSION}_${arch}.deb"
	RPM_TARGET[$arch]="$RPM/Packages/${PACKAGE}-${VERSION}-${release}.$(rpm_arch "$arch").rpm"
	RPM_SOURCE[$arch]="$rpm_file"
done

published=true
for arch in "${ARCHES[@]}"; do
	[[ -f "${DEB_TARGET[$arch]}" && -f "${RPM_TARGET[$arch]}" ]] || published=false
done
if [[ "$published" == true ]]; then
	echo "The repository already has $PACKAGE $VERSION; nothing to do."
	exit 0
fi

shopt -s nullglob

deb_version() {
	local name
	name="$(basename "$1" .deb)"
	name="${name#"${PACKAGE}"_}"
	echo "${name%_*}"
}

rpm_version() {
	local name
	name="$(basename "$1" .rpm)"
	name="${name#"${PACKAGE}"-}"
	name="${name%.*}"
	echo "${name%-*}"
}

# Every version the repository has, oldest first.
versions() {
	{
		for file in "$POOL"/*.deb; do deb_version "$file"; done
		for file in "$RPM"/Packages/*.rpm; do rpm_version "$file"; done
	} | sort --unique --version-sort
}

# A version older than all the repository keeps would be removed again at
# once (a re-run of an old release's job): leave the repository as it is.
mapfile -t VERSIONS < <(versions)
if ((${#VERSIONS[@]} >= KEEP)); then
	oldest_kept="${VERSIONS[${#VERSIONS[@]}-KEEP]}"
	if [[ "$VERSION" != "$oldest_kept" && "$(printf '%s\n%s\n' "$VERSION" "$oldest_kept" | sort --version-sort | sed -n 1p)" == "$VERSION" ]]; then
		echo "$PACKAGE $VERSION is older than the $KEEP versions the repository keeps; nothing to do."
		exit 0
	fi
fi

# ─── Add them: the .debs as they are, the .rpms signed ───────────────────

mkdir -p "$POOL" "$RPM/Packages"
for arch in "${ARCHES[@]}"; do
	if [[ ! -f "${DEB_TARGET[$arch]}" ]]; then
		cp "$PACKAGES/${PACKAGE}_${arch}.deb" "${DEB_TARGET[$arch]}"
	fi
	if [[ ! -f "${RPM_TARGET[$arch]}" ]]; then
		# Signed in a copy, moved into place only once signed: a package in
		# Packages/ is one the repository serves.
		cp "${RPM_SOURCE[$arch]}" "$WORK/unsigned.rpm"
		"${RPMSIGN[@]}" "$WORK/unsigned.rpm" >/dev/null
		mv "$WORK/unsigned.rpm" "${RPM_TARGET[$arch]}"
	fi
done

# ─── Keep the newest versions ────────────────────────────────────────────

mapfile -t VERSIONS < <(versions)

if ((${#VERSIONS[@]} > KEEP)); then
	for old in "${VERSIONS[@]:0:${#VERSIONS[@]}-KEEP}"; do
		echo "Removing $PACKAGE $old, which is older than the newest $KEEP."
		for file in "$POOL"/*.deb; do
			[[ "$(deb_version "$file")" == "$old" ]] && rm -f "$file"
		done
		for file in "$RPM"/Packages/*.rpm; do
			[[ "$(rpm_version "$file")" == "$old" ]] && rm -f "$file"
		done
	done
fi

# ─── apt ─────────────────────────────────────────────────────────────────
#
# InRelease is one file, signed inline, so a client never pairs a Release
# with another generation's signature. The indexes it names are also served
# under by-hash/ (Acquire-By-Hash), and the previous generation's stay there:
# a client, or a cache in front of the site, that still holds the previous
# InRelease fetches the indexes that one names, not the new ones under the
# old name, which apt rejects as "Hash Sum mismatch".

declare -A KEEP_HASHES=()
if [[ -f "$DISTS/Release" ]]; then
	while read -r hash; do
		KEEP_HASHES[$hash]=1
	done < <(awk '/^SHA256:/ { listed = 1; next } /^[^ ]/ { listed = 0 } listed { print $1 }' "$DISTS/Release")
fi

for arch in "${ARCHES[@]}"; do
	index="$DISTS/$COMPONENT/binary-$arch"
	mkdir -p "$index/by-hash/SHA256"
	(
		cd "$DEB"
		apt-ftparchive --arch "$arch" \
			-o APT::FTPArchive::Packages::MD5=false \
			-o APT::FTPArchive::Packages::SHA1=false \
			packages "pool/$COMPONENT"
	) >"$index/Packages"
	gzip -9 --no-name --stdout "$index/Packages" >"$index/Packages.gz"

	for file in "$index/Packages" "$index/Packages.gz"; do
		hash="$(sha256sum "$file" | cut -d' ' -f1)"
		cp "$file" "$index/by-hash/SHA256/$hash"
		KEEP_HASHES[$hash]=1
	done
done

for arch in "${ARCHES[@]}"; do
	for file in "$DISTS/$COMPONENT/binary-$arch/by-hash/SHA256"/*; do
		if [[ -z "${KEEP_HASHES[$(basename "$file")]:-}" ]]; then
			rm -f "$file"
		fi
	done
done

rm -f "$DISTS/Release" "$DISTS/InRelease" "$DISTS/Release.gpg"
apt-ftparchive \
	-o APT::FTPArchive::Release::Origin=OneUptime \
	-o APT::FTPArchive::Release::Label=OneUptime \
	-o APT::FTPArchive::Release::Suite="$SUITE" \
	-o APT::FTPArchive::Release::Codename="$SUITE" \
	-o APT::FTPArchive::Release::Architectures="${ARCHES[*]}" \
	-o APT::FTPArchive::Release::Components="$COMPONENT" \
	-o APT::FTPArchive::Release::Description="OneUptime packages" \
	-o APT::FTPArchive::Release::Acquire-By-Hash=yes \
	-o APT::FTPArchive::Release::MD5=false \
	-o APT::FTPArchive::Release::SHA1=false \
	-o APT::FTPArchive::Release::SHA512=false \
	release "$DISTS" >"$WORK/Release"
mv "$WORK/Release" "$DISTS/Release"
grep -qx 'Acquire-By-Hash: yes' "$DISTS/Release" ||
	fail "apt-ftparchive wrote no Acquire-By-Hash field"

"${GPG[@]}" --clearsign --output "$DISTS/InRelease" "$DISTS/Release"
"${GPG[@]}" --armor --detach-sign --output "$DISTS/Release.gpg" "$DISTS/Release"

# ─── yum and dnf ─────────────────────────────────────────────────────────
#
# createrepo_c names every metadata file by its checksum and keeps the
# previous generation's (--retain-old-md), for the same reason as by-hash
# above. gz rather than createrepo_c's default zstd, which yum on EL7 and
# dnf on early EL8 cannot read.

createrepo_c --quiet --update --retain-old-md 1 --no-database \
	--general-compress-type gz "$RPM"
"${GPG[@]}" --armor --detach-sign --output "$RPM/repodata/repomd.xml.asc" "$RPM/repodata/repomd.xml"

# ─── What a machine needs to trust and add the repositories ──────────────

gpg --batch --armor --export "$SIGNING_KEY" >"$REPOSITORY/gpg.key"

cat >"$RPM/oneuptime.repo" <<EOF
[oneuptime]
name=OneUptime
baseurl=$BASE_URL/rpm
enabled=1
gpgcheck=1
repo_gpgcheck=1
gpgkey=$BASE_URL/gpg.key
EOF

cat >"$REPOSITORY/index.html" <<EOF
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OneUptime packages</title>
</head>
<body>
<h1>OneUptime packages</h1>
<p>Signed apt and yum repositories for the OneUptime infrastructure agent. Setup and usage: <a href="https://oneuptime.com/docs/monitor/server-monitor">Server / VM Monitor</a>.</p>
<h2>Debian and Ubuntu</h2>
<pre>sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL $BASE_URL/gpg.key -o /etc/apt/keyrings/oneuptime.asc
sudo chmod a+r /etc/apt/keyrings/oneuptime.asc
echo "deb [signed-by=/etc/apt/keyrings/oneuptime.asc] $BASE_URL/deb $SUITE $COMPONENT" | sudo tee /etc/apt/sources.list.d/oneuptime.list
sudo apt-get update
sudo apt-get install $PACKAGE</pre>
<h2>RHEL, Rocky Linux, AlmaLinux, Fedora and Amazon Linux</h2>
<pre>sudo curl -fsSL $BASE_URL/rpm/oneuptime.repo -o /etc/yum.repos.d/oneuptime.repo
sudo dnf install $PACKAGE</pre>
<p>The repositories are signed with <a href="gpg.key">this key</a>.</p>
</body>
</html>
EOF

# ─── Check the signatures before anything is published ───────────────────

CHECK=(gpg --batch --quiet --homedir "$WORK/check-keyring")
mkdir -m 700 "$WORK/check-keyring"
"${CHECK[@]}" --import "$REPOSITORY/gpg.key" 2>/dev/null
"${CHECK[@]}" --verify "$DISTS/InRelease" 2>/dev/null ||
	fail "InRelease does not verify against gpg.key"
"${CHECK[@]}" --verify "$DISTS/Release.gpg" "$DISTS/Release" 2>/dev/null ||
	fail "Release.gpg does not verify against gpg.key"
"${CHECK[@]}" --verify "$RPM/repodata/repomd.xml.asc" "$RPM/repodata/repomd.xml" 2>/dev/null ||
	fail "repomd.xml.asc does not verify against gpg.key"

rpmkeys --dbpath "$WORK/rpmdb" --import "$REPOSITORY/gpg.key"
for file in "$RPM"/Packages/*.rpm; do
	checked="$(rpmkeys --dbpath "$WORK/rpmdb" --checksig "$file")"
	[[ "$checked" == *"signatures OK"* ]] ||
		fail "$(basename "$file") is not signed with gpg.key: $checked"
done

kept=$((${#VERSIONS[@]} > KEEP ? ${#VERSIONS[@]} - KEEP : 0))
echo "Added $PACKAGE $VERSION. The repository has: ${VERSIONS[*]:kept}"
