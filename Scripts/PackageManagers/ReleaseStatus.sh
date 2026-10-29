#!/usr/bin/env bash
#
# Where one release of the OneUptime infrastructure agent has got to, in
# every place people install it from:
#
#   GitHub release   the archives, packages and MSIs everything else points
#                    at (and the install script downloads)
#   apt, yum         https://packages.oneuptime.com, from OneUptime/packages
#   Homebrew         the cask in OneUptime/homebrew-tap
#   winget           OneUptime.InfrastructureAgent in microsoft/winget-pkgs
#
# and the two things apt and yum stop working without: the key the
# repositories are signed with, and the site's HTTPS certificate.
#
# Usage: ReleaseStatus.sh [<version>]    (default: the latest GitHub release)
#
# It prints a Markdown table, to $GITHUB_STEP_SUMMARY as well when that is
# set, giving each one of these states:
#
#   published    people install this version from it
#   superseded   it has a newer release instead (only for an older version)
#   waiting      not yet, and nothing is wrong: for RELEASE_STATUS_GRACE_HOURS
#                (6) after the release, while the publish jobs and the Pages
#                deploy catch up; for as long again after the site's latest
#                Pages deploy started, while it has not failed, for a version
#                OneUptime/packages has (a publish job re-run hours after the
#                release publishes only then); and for winget, while Microsoft
#                reviews the pull request, however long that takes
#   attention    works, but not for long: the key or the certificate expires
#                soon
#   problem      what people install is missing, wrong or broken, or a winget
#                pull request needs us
#
# and exits 1 when any is a problem. agents/InfrastructureAgent/RELEASING.md
# says what to do about each. The "Infrastructure Agent Release Status"
# workflow runs this after every release and every day, and writes each
# state to $GITHUB_OUTPUT.
#
# Needs curl, gh (signed in, or GH_TOKEN), jq, gpg, gzip, python3 and openssl.
# PACKAGE_REPOSITORY_URL, PACKAGE_SIGNING_KEY_FINGERPRINT and
# RELEASE_STATUS_RETRY_SECONDS are for the tests.

set -euo pipefail

readonly PACKAGE="oneuptime-infrastructure-agent"
readonly RELEASES="OneUptime/oneuptime"
readonly SITE_REPOSITORY="OneUptime/packages"
readonly TAP="OneUptime/homebrew-tap"
readonly CASK="Casks/$PACKAGE.rb"
readonly WINGET="microsoft/winget-pkgs"
readonly WINGET_ID="OneUptime.InfrastructureAgent"
readonly WINGET_DIR="manifests/o/OneUptime/InfrastructureAgent"
readonly GUIDE="https://github.com/OneUptime/oneuptime/blob/master/agents/InfrastructureAgent/RELEASING.md"

REPOSITORY_URL="${PACKAGE_REPOSITORY_URL:-https://packages.oneuptime.com}"
# key@oneuptime.com, the release key the repositories are signed with.
SIGNING_KEY="${PACKAGE_SIGNING_KEY_FINGERPRINT:-83F2C1DDF58A052464C4A1729D87E494AC016697}"
GRACE_HOURS="${RELEASE_STATUS_GRACE_HOURS:-6}"

# What the package managers and the install script download from the release.
readonly ASSETS=(
	"${PACKAGE}_linux_amd64.tar.gz"
	"${PACKAGE}_linux_arm64.tar.gz"
	"${PACKAGE}_darwin_amd64.tar.gz"
	"${PACKAGE}_darwin_arm64.tar.gz"
	"${PACKAGE}_windows_amd64.zip"
	"${PACKAGE}_windows_arm64.zip"
	"${PACKAGE}_amd64.deb"
	"${PACKAGE}_arm64.deb"
	"${PACKAGE}_amd64.rpm"
	"${PACKAGE}_arm64.rpm"
	"$PACKAGE-amd64.msi"
	"$PACKAGE-arm64.msi"
)

fail() {
	echo "ReleaseStatus: $*" >&2
	exit 2
}

for tool in curl gh jq gpg gzip python3 openssl; do
	command -v "$tool" >/dev/null || fail "needs $tool"
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
KEYRING="$WORK/keyring"
mkdir -m 700 "$KEYRING"

# ─── Helpers ─────────────────────────────────────────────────────────────

# github <endpoint> <file> [media type]: 0 when GitHub answers, 1 when it
# answers 404. Anything else is asked again, then stops the script: an
# outage must not read as "not published".
github() {
	local attempt status
	for attempt in 1 2 3; do
		status=0
		gh api -H "Accept: ${3:-application/vnd.github+json}" "$1" >"$2" 2>"$WORK/github-error" || status=$?
		if ((status == 0)); then
			return 0
		fi
		if grep -q "HTTP 404" "$WORK/github-error"; then
			return 1
		fi
		sleep $((attempt * ${RELEASE_STATUS_RETRY_SECONDS:-5}))
	done
	fail "could not ask GitHub for $1: $(cat "$WORK/github-error")"
}

# A file of a GitHub repository, as it is now (the API, not a cached copy).
github_file() {
	github "repos/$1/contents/$2" "$3" "application/vnd.github.raw+json"
}

# fetch <url> <file>: 0 when it downloaded; otherwise why not, on stdout.
fetch() {
	local why
	if why="$(curl -fsSL --retry 2 --connect-timeout 20 --max-time 300 -o "$2" "$1" 2>&1)"; then
		return 0
	fi
	echo "${why:-curl failed}"
	return 1
}

# Whether a URL answers, without downloading it.
reachable() {
	curl -fsSIL --retry 2 --connect-timeout 20 --max-time 60 -o /dev/null "$1" 2>/dev/null
}

sha256() {
	if command -v sha256sum >/dev/null; then
		sha256sum "$1"
	else
		shasum -a 256 "$1"
	fi | awk '{ print $1 }'
}

# Seconds since 1970 of an ISO 8601 time. (jq 1.6 reads it as local time.)
epoch() {
	python3 -I -c 'import datetime, sys; print(int(datetime.datetime.fromisoformat(sys.argv[1].replace("Z", "+00:00")).timestamp()))' "$1"
}

day() {
	python3 -I -c 'import datetime, sys; print(datetime.datetime.fromtimestamp(int(sys.argv[1]), datetime.timezone.utc).strftime("%Y-%m-%d"))' "$1"
}

# A duration, from seconds.
for_how_long() {
	local hours=$(($1 / 3600))
	if ((hours < 2)); then
		echo "$(($1 / 60)) minutes"
	elif ((hours < 48)); then
		echo "$hours hours"
	else
		echo "$((hours / 24)) days"
	fi
}

newest() {
	sort -V | tail -n 1
}

# Whether version $1 is newer than version $2.
newer_than() {
	[[ "$1" != "$2" && "$(printf '%s\n%s\n' "$1" "$2" | newest)" == "$1" ]]
}

ROWS=()
PROBLEMS=0

# row <output name> <channel> <state> <details>
row() {
	local label
	case "$3" in
	published) label="✅ published" ;;
	superseded) label="✅ superseded" ;;
	waiting) label="⏳ waiting" ;;
	attention) label="⚠️ attention" ;;
	problem)
		label="❌ problem"
		PROBLEMS=$((PROBLEMS + 1))
		;;
	*) fail "unknown state $3" ;;
	esac
	ROWS+=("| $2 | $label | ${4//|/\\|} |")
	if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
		echo "$1=$3" >>"$GITHUB_OUTPUT"
	fi
	if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
		case "$3" in
		problem) echo "::error title=$2::$4" ;;
		attention) echo "::warning title=$2::$4" ;;
		esac
	fi
}

# ─── The release ─────────────────────────────────────────────────────────

github "repos/$RELEASES/releases/latest" "$WORK/latest.json" ||
	fail "$RELEASES has no published release"
LATEST="$(jq -r .tag_name "$WORK/latest.json")"
VERSION="${1:-$LATEST}"
if [[ "$VERSION" == "$LATEST" ]]; then
	cp "$WORK/latest.json" "$WORK/release.json"
else
	github "repos/$RELEASES/releases/tags/$VERSION" "$WORK/release.json" ||
		fail "$RELEASES has no release $VERSION"
fi

RELEASED="$(epoch "$(jq -r .published_at "$WORK/release.json")")"
jq -r '.assets[] | "\(.name) \(.digest // "none")"' "$WORK/release.json" >"$WORK/assets"
AGE=$(($(date +%s) - RELEASED))

within_grace() {
	((AGE < GRACE_HOURS * 3600))
}

# The SHA-256 GitHub records for one of the release's assets; empty when the
# release has no such asset.
asset_sha256() {
	local digest url
	digest="$(awk -v name="$1" '$1 == name { print $2; exit }' "$WORK/assets")"
	case "$digest" in
	"") ;;
	sha256:*) echo "${digest#sha256:}" ;;
	*)
		# Uploaded before GitHub recorded digests: download it.
		url="$(jq -r --arg name "$1" '.assets[] | select(.name == $name) | .browser_download_url' "$WORK/release.json")"
		fetch "$url" "$WORK/asset" >/dev/null && sha256 "$WORK/asset"
		;;
	esac
}

check_release() {
	local asset missing=() details
	for asset in "${ASSETS[@]}"; do
		[[ -n "$(asset_sha256 "$asset")" ]] || missing+=("$asset")
	done
	details="released $(day "$RELEASED"), $(for_how_long "$AGE") ago"
	if ((${#missing[@]} > 0)); then
		details+=", without ${missing[*]}"
	else
		details+=", with the ${#ASSETS[@]} archives, packages and MSIs"
	fi
	if [[ "$VERSION" != "$LATEST" ]]; then
		details+="; $LATEST is the latest, which the install script installs"
	fi
	if [[ "$(jq -r .prerelease "$WORK/release.json")" == "true" ]]; then
		details+="; marked a pre-release"
	fi
	if ((${#missing[@]} > 0)); then
		row github "GitHub release" problem "$details"
	else
		row github "GitHub release" published "$details"
	fi
}

# ─── packages.oneuptime.com ──────────────────────────────────────────────

# Whether release.yml has pushed this version to OneUptime/packages, which
# GitHub Pages then deploys to the site: how "not on the site yet" is told
# apart from "not published at all".
SITE_PUSHED=false
if github_file "$SITE_REPOSITORY" "deb/dists/stable/main/binary-amd64/Packages?ref=main" "$WORK/pushed-Packages" &&
	grep -qx "Version: $VERSION" "$WORK/pushed-Packages"; then
	SITE_PUSHED=true
fi

# Whether the site repository has a Pages deploy, its latest one read once
# into $WORK/pages.json (the rows that ask run in subshells).
has_pages_deploy() {
	if [[ ! -e "$WORK/pages.json" ]] &&
		! github "repos/$SITE_REPOSITORY/actions/runs?per_page=1" "$WORK/pages.json"; then
		echo '{"workflow_runs": []}' >"$WORK/pages.json"
	fi
	[[ "$(jq '.workflow_runs | length' "$WORK/pages.json")" -gt 0 ]]
}

# Why the site does not have the version yet, for the details.
site_lag() {
	local run
	if [[ "$SITE_PUSHED" != "true" ]]; then
		echo "$SITE_REPOSITORY does not have it either: see publish-infrastructure-agent-apt-yum in the release run"
		return
	fi
	if has_pages_deploy; then
		run="$(jq -r '.workflow_runs[0] | "started \(.created_at), is \(.status)\(if .conclusion then " (" + .conclusion + ")" else "" end)"' "$WORK/pages.json")"
		echo "$SITE_REPOSITORY has it; its latest Pages deploy, $run"
	else
		echo "$SITE_REPOSITORY has it, and has no Pages deploy"
	fi
}

# The state of a version the site does not serve: waiting while the release
# is young, a problem after.
missing_state() {
	if within_grace; then
		echo waiting
	else
		echo problem
	fi
}

# Whether the site is still deploying a version the site repository has: its
# latest Pages deploy started less than RELEASE_STATUS_GRACE_HOURS ago and has
# not failed. A publish job re-run hours after the release (RELEASING.md's
# remedy for a failed one) pushes the version only then, and the release run's
# end runs this while that deploy still waits for a runner.
site_catching_up() {
	local started
	[[ "$SITE_PUSHED" == "true" ]] && has_pages_deploy || return 1
	jq -e '.workflow_runs[0] | .status != "completed" or .conclusion == "success"' "$WORK/pages.json" >/dev/null ||
		return 1
	started="$(epoch "$(jq -r '.workflow_runs[0].created_at' "$WORK/pages.json")")"
	(($(date +%s) - started < GRACE_HOURS * 3600))
}

# The state of a version the site does not serve yet: missing_state's, but
# waiting too while the site catches up with a version pushed late.
site_behind_state() {
	if within_grace || site_catching_up; then
		echo waiting
	else
		echo problem
	fi
}

# The key gpg.key holds: what the repositories must be signed with.
KEY_READY=false
check_signing_key() {
	local why fingerprint expiry="" expires
	if ! why="$(fetch "$REPOSITORY_URL/gpg.key" "$WORK/gpg.key")"; then
		row key "Signing key" "$(missing_state)" "could not download $REPOSITORY_URL/gpg.key: $why"
		return
	fi
	if ! gpg --homedir "$KEYRING" --no-autostart --batch --quiet --import "$WORK/gpg.key" 2>/dev/null; then
		row key "Signing key" problem "$REPOSITORY_URL/gpg.key is not a key gpg can read"
		return
	fi
	gpg --homedir "$KEYRING" --no-autostart --batch --with-colons --fingerprint >"$WORK/key.txt" 2>/dev/null
	fingerprint="$(awk -F: '$1 == "fpr" { print $10; exit }' "$WORK/key.txt")"
	if [[ "$fingerprint" != "$SIGNING_KEY" ]]; then
		row key "Signing key" problem "$REPOSITORY_URL/gpg.key is $fingerprint, not the release key $SIGNING_KEY"
		return
	fi
	KEY_READY=true

	# When the last of its keys that can sign expires: the primary key or a
	# subkey with s among its own capabilities, not revoked or invalid.
	while IFS=: read -r expires _; do
		if [[ -z "$expires" ]]; then
			expiry="never"
			break
		fi
		if [[ -z "$expiry" ]] || ((expires > expiry)); then
			expiry="$expires"
		fi
	done < <(awk -F: '($1 == "pub" || $1 == "sub") && $12 ~ /s/ && $2 !~ /[ri]/ { print $7 ":" $12 }' "$WORK/key.txt")

	if [[ -z "$expiry" ]]; then
		row key "Signing key" problem "${SIGNING_KEY: -16} has no key left that can sign"
	elif [[ "$expiry" == "never" ]]; then
		row key "Signing key" published "${SIGNING_KEY: -16}, does not expire"
	elif ((expiry <= $(date +%s))); then
		row key "Signing key" problem "${SIGNING_KEY: -16} expired on $(day "$expiry"): apt and dnf refuse the repositories"
	elif ((expiry - $(date +%s) < 90 * 86400)); then
		row key "Signing key" attention "${SIGNING_KEY: -16} expires on $(day "$expiry"): extend it, then publish its gpg.key"
	else
		row key "Signing key" published "${SIGNING_KEY: -16}, can sign until $(day "$expiry")"
	fi
}

# verify <signature> [<signed file>] [<output>]: 0 when the release key made
# the signature. A clear-signed file's signed text is written to <output>.
verify() {
	local status
	if [[ -n "${3:-}" ]]; then
		gpg --homedir "$KEYRING" --no-autostart --batch --yes --status-fd 1 --output "$3" --decrypt "$1" >"$WORK/gpg-status" 2>/dev/null || true
	else
		gpg --homedir "$KEYRING" --no-autostart --batch --status-fd 1 --verify "$1" "$2" >"$WORK/gpg-status" 2>/dev/null || true
	fi
	# VALIDSIG's last field is the fingerprint of the signing key's primary key.
	status="$(awk '$2 == "VALIDSIG" { print $NF }' "$WORK/gpg-status")"
	[[ "$status" == "$SIGNING_KEY" ]]
}

check_apt() {
	local base="$REPOSITORY_URL/deb" why arch index index_hash entry sha filename found=() versions=""
	if [[ "$KEY_READY" != "true" ]]; then
		row apt "apt" "$(missing_state)" "nothing to verify it with: see the signing key; $(site_lag)"
		return
	fi
	if ! why="$(fetch "$base/dists/stable/InRelease" "$WORK/InRelease")"; then
		row apt "apt" "$(missing_state)" "could not download $base/dists/stable/InRelease: $why; $(site_lag)"
		return
	fi
	if ! verify "$WORK/InRelease" "" "$WORK/Release"; then
		row apt "apt" problem "InRelease is not signed by the release key: apt refuses the repository"
		return
	fi
	for arch in amd64 arm64; do
		index="main/binary-$arch/Packages"
		index_hash="$(awk -v index_path="$index" '/^SHA256:/ { listed = 1; next } /^[^ ]/ { listed = 0 } listed && $3 == index_path { print $1 }' "$WORK/Release")"
		if [[ -z "$index_hash" ]]; then
			row apt "apt" problem "InRelease lists no $index"
			return
		fi
		# By hash, as apt fetches it: a file that cannot be from another
		# generation of the site than the InRelease that names it.
		if ! why="$(fetch "$base/dists/stable/main/binary-$arch/by-hash/SHA256/$index_hash" "$WORK/Packages-$arch")"; then
			row apt "apt" problem "could not download the $index InRelease names: $why"
			return
		fi
		if [[ "$(sha256 "$WORK/Packages-$arch")" != "$index_hash" ]]; then
			row apt "apt" problem "$index is not the one InRelease names"
			return
		fi
		versions+="$(awk '/^Version: / { print $2 }' "$WORK/Packages-$arch")"$'\n'
		entry="$(awk -v RS= -v package="$PACKAGE" -v version="$VERSION" '
			{
				name = ""; ver = ""; sha = ""; file = ""
				count = split($0, lines, "\n")
				for (i = 1; i <= count; i++) {
					if (lines[i] ~ /^Package: /) name = substr(lines[i], 10)
					else if (lines[i] ~ /^Version: /) ver = substr(lines[i], 10)
					else if (lines[i] ~ /^SHA256: /) sha = substr(lines[i], 9)
					else if (lines[i] ~ /^Filename: /) file = substr(lines[i], 11)
				}
				if (name == package && ver == version) { print sha, file; exit }
			}' "$WORK/Packages-$arch")"
		[[ -n "$entry" ]] || continue
		read -r sha filename <<<"$entry"
		if [[ "$sha" != "$(asset_sha256 "${PACKAGE}_$arch.deb")" ]]; then
			row apt "apt" problem "the $arch package is not the release's ${PACKAGE}_$arch.deb (SHA-256 $sha)"
			return
		fi
		if ! reachable "$base/$filename"; then
			row apt "apt" problem "$base/$filename, which the $arch index lists, does not download"
			return
		fi
		found+=("$arch")
	done
	apt_or_yum_row apt "apt" "$(printf '%s' "$versions" | newest)" "${found[@]+"${found[@]}"}"
}

# apt_or_yum_row <output name> <channel> <newest version> <architectures found>...
apt_or_yum_row() {
	local name="$1" channel="$2" repository_newest="$3"
	shift 3
	if (($# == 2)); then
		row "$name" "$channel" published "$VERSION for amd64 and arm64, signed by the release key"
	elif (($# == 1)); then
		row "$name" "$channel" problem "$VERSION is there for $1 only"
	elif [[ -n "$repository_newest" ]] && newer_than "$repository_newest" "$VERSION"; then
		row "$name" "$channel" superseded "the repository has $repository_newest"
	else
		row "$name" "$channel" "$(site_behind_state)" "the site has ${repository_newest:-nothing}, not $VERSION; $(site_lag)"
	fi
}

# The <data> entries of repomd.xml, or the agent's packages in primary.xml.
read_xml() {
	python3 -I - "$@" <<'PYTHON'
import sys
import xml.etree.ElementTree as ElementTree

what, path = sys.argv[1], sys.argv[2]
root = ElementTree.parse(path).getroot()
if what == "repomd":
    ns = {"r": "http://linux.duke.edu/metadata/repo"}
    for data in root.findall("r:data", ns):
        checksum = data.find("r:checksum", ns)
        print(data.get("type"), checksum.get("type"), checksum.text.strip(), data.find("r:location", ns).get("href"))
else:
    ns = {"c": "http://linux.duke.edu/metadata/common"}
    for package in root.findall("c:package", ns):
        if package.findtext("c:name", namespaces=ns) != sys.argv[3]:
            continue
        version = package.find("c:version", ns)
        print(package.findtext("c:arch", namespaces=ns), version.get("ver"), package.find("c:location", ns).get("href"))
PYTHON
}

check_yum() {
	local base="$REPOSITORY_URL/rpm" why attempt kind checksum_type checksum href arch rpm_arch version found=() versions=""
	if [[ "$KEY_READY" != "true" ]]; then
		row yum "yum and dnf" "$(missing_state)" "nothing to verify it with: see the signing key; $(site_lag)"
		return
	fi
	# repomd.xml and its signature are two files the site's cache may hold
	# from two deploys for a few minutes after one: ask again once.
	for attempt in 1 2; do
		if ! why="$(fetch "$base/repodata/repomd.xml" "$WORK/repomd.xml")" ||
			! why="$(fetch "$base/repodata/repomd.xml.asc" "$WORK/repomd.xml.asc")"; then
			row yum "yum and dnf" "$(missing_state)" "could not download $base/repodata/repomd.xml and its signature: $why; $(site_lag)"
			return
		fi
		if verify "$WORK/repomd.xml.asc" "$WORK/repomd.xml"; then
			break
		fi
		if ((attempt == 2)); then
			row yum "yum and dnf" problem "repomd.xml is not signed by the release key: dnf refuses the repository"
			return
		fi
		sleep "${RELEASE_STATUS_RETRY_SECONDS:-60}"
	done
	while read -r kind checksum_type checksum href; do
		[[ "$kind" == "primary" ]] || continue
		if [[ "$checksum_type" != "sha256" ]]; then
			row yum "yum and dnf" problem "repomd.xml gives primary.xml a $checksum_type checksum, not sha256"
			return
		fi
		if ! why="$(fetch "$base/$href" "$WORK/primary.xml.gz")"; then
			row yum "yum and dnf" problem "could not download $href, which repomd.xml names: $why"
			return
		fi
		if [[ "$(sha256 "$WORK/primary.xml.gz")" != "$checksum" ]]; then
			row yum "yum and dnf" problem "$href is not the one repomd.xml names"
			return
		fi
	done < <(read_xml repomd "$WORK/repomd.xml")
	if [[ ! -f "$WORK/primary.xml.gz" ]]; then
		row yum "yum and dnf" problem "repomd.xml names no primary.xml"
		return
	fi
	if ! gzip -dc "$WORK/primary.xml.gz" >"$WORK/primary.xml" 2>/dev/null ||
		! read_xml primary "$WORK/primary.xml" "$PACKAGE" >"$WORK/rpms" 2>/dev/null; then
		row yum "yum and dnf" problem "primary.xml does not parse"
		return
	fi
	versions="$(awk '{ print $2 }' "$WORK/rpms")"
	for arch in amd64 arm64; do
		case "$arch" in
		amd64) rpm_arch="x86_64" ;;
		arm64) rpm_arch="aarch64" ;;
		esac
		href="$(awk -v arch="$rpm_arch" -v version="$VERSION" '$1 == arch && $2 == version { print $3; exit }' "$WORK/rpms")"
		[[ -n "$href" ]] || continue
		# Not compared with the release's .rpm: the repository signs each one.
		if ! reachable "$base/$href"; then
			row yum "yum and dnf" problem "$base/$href, which primary.xml lists, does not download"
			return
		fi
		found+=("$arch")
	done
	if ! reachable "$base/oneuptime.repo"; then
		row yum "yum and dnf" problem "$base/oneuptime.repo, which the docs download, is missing"
		return
	fi
	version="$(printf '%s\n' "$versions" | newest)"
	apt_or_yum_row yum "yum and dnf" "$version" "${found[@]+"${found[@]}"}"
}

check_certificate() {
	local host
	case "$REPOSITORY_URL" in
	https://*) ;;
	*) return ;;
	esac
	host="${REPOSITORY_URL#https://}"
	host="${host%%/*}"
	if ! openssl s_client -connect "$host:443" -servername "$host" </dev/null 2>/dev/null |
		openssl x509 -out "$WORK/certificate.pem" 2>/dev/null; then
		row https "HTTPS certificate" problem "$host sent no certificate"
		return
	fi
	local expires_on
	expires_on="$(openssl x509 -noout -enddate -in "$WORK/certificate.pem" | cut -d= -f2)"
	if ! openssl x509 -noout -checkend 0 -in "$WORK/certificate.pem" >/dev/null; then
		row https "HTTPS certificate" problem "$host's certificate expired on $expires_on"
	elif ! openssl x509 -noout -checkend $((14 * 86400)) -in "$WORK/certificate.pem" >/dev/null; then
		row https "HTTPS certificate" attention "$host's certificate expires on $expires_on, and GitHub Pages has not renewed it"
	else
		row https "HTTPS certificate" published "$host, valid until $expires_on (GitHub Pages renews it)"
	fi
}

# ─── Homebrew ────────────────────────────────────────────────────────────

check_homebrew() {
	local version asset expected listed
	if ! github_file "$TAP" "$CASK?ref=main" "$WORK/cask.rb"; then
		row homebrew "Homebrew" problem "$TAP has no $CASK"
		return
	fi
	version="$(awk -F '"' '/^  version "/ { print $2; exit }' "$WORK/cask.rb")"
	if [[ "$version" != "$VERSION" ]]; then
		if [[ -n "$version" ]] && newer_than "$version" "$VERSION"; then
			row homebrew "Homebrew" superseded "the tap has $version"
		else
			row homebrew "Homebrew" "$(missing_state)" "the tap has ${version:-no version}, not $VERSION: see publish-infrastructure-agent-homebrew in the release run"
		fi
		return
	fi
	for asset in "${PACKAGE}_darwin_amd64.tar.gz" "${PACKAGE}_darwin_arm64.tar.gz"; do
		expected="$(asset_sha256 "$asset")"
		# The sha256 line before the url line that downloads the asset.
		listed="$(awk -F '"' -v asset="$asset" '/^ *sha256 "/ { sha = $2 } /^ *url "/ && index($2, "/" asset) { print sha; exit }' "$WORK/cask.rb")"
		if [[ -z "$listed" ]]; then
			row homebrew "Homebrew" problem "the cask does not download $asset"
			return
		fi
		if [[ "$listed" != "$expected" ]]; then
			row homebrew "Homebrew" problem "the cask's SHA-256 for $asset is not the release's: brew refuses the download"
			return
		fi
	done
	row homebrew "Homebrew" published "$VERSION, for Apple silicon and Intel"
}

# ─── winget ──────────────────────────────────────────────────────────────

# The labels of a winget-pkgs pull request that ask something of us rather
# than of Microsoft: the CLA, the author's feedback, or an error in what was
# sent. (Microsoft's own pipeline errors, Internal-Error-*, it retries.)
labels_needing_us() {
	grep -E '^(Needs-CLA|Needs-Author-Feedback|Changes-Requested|Manifest-Content-Incomplete|Package-Metadata-Invalid|Possible-Duplicate)$|(^|-)(Error|Failed)(-|$)' |
		grep -vE '^(Internal-Error|Waived-)|^Error-Analysis-Timeout$' || true
}

check_winget() {
	local asset hash listed number state merged labels label_list needs_us url others age stage
	if github "repos/$WINGET/contents/$WINGET_DIR/$VERSION" "$WORK/winget-dir.json"; then
		if ! github_file "$WINGET" "$WINGET_DIR/$VERSION/$WINGET_ID.installer.yaml" "$WORK/installer.yaml"; then
			row winget "winget" problem "$WINGET has $VERSION without its installer manifest"
			return
		fi
		for asset in "${PACKAGE}_windows_amd64.zip" "${PACKAGE}_windows_arm64.zip"; do
			hash="$(asset_sha256 "$asset" | tr '[:lower:]' '[:upper:]')"
			listed="$(awk '/InstallerSha256:/ { print toupper($2) }' "$WORK/installer.yaml")"
			if ! grep -qx "$hash" <<<"$listed"; then
				row winget "winget" problem "$WINGET's $VERSION does not install the release's $asset: winget refuses it"
				return
			fi
		done
		row winget "winget" published "$VERSION is in $WINGET"
		return
	fi

	gh api -X GET search/issues -f q="repo:$WINGET is:pr in:title $WINGET_ID" -f per_page=100 >"$WORK/pulls.json" 2>"$WORK/github-error" ||
		fail "could not search $WINGET's pull requests: $(cat "$WORK/github-error")"
	others="$(jq -r --arg version "$VERSION" '[.items[] | select(.state == "open" and (.title | test("version [^ ]+$"))) | (.title | capture("version (?<v>[^ ]+)$").v) as $v | select($v != $version) | "#\(.number) (\($v))"] | join(", ")' "$WORK/pulls.json")"
	others="${others:+; also open: $others}"
	jq --arg version "$VERSION" '[.items[] | select(.title | endswith("version " + $version))] | sort_by(.created_at) | last // empty' "$WORK/pulls.json" >"$WORK/pull.json"
	if [[ ! -s "$WORK/pull.json" ]]; then
		if within_grace; then
			row winget "winget" waiting "no pull request yet: publish-infrastructure-agent-winget opens it once the release is out$others"
		else
			row winget "winget" problem "no pull request to $WINGET: see publish-infrastructure-agent-winget in the release run$others"
		fi
		return
	fi
	number="$(jq -r .number "$WORK/pull.json")"
	url="https://github.com/$WINGET/pull/$number"
	state="$(jq -r .state "$WORK/pull.json")"
	merged="$(jq -r '.pull_request.merged_at // empty' "$WORK/pull.json")"
	labels="$(jq -r '.labels[].name' "$WORK/pull.json")"
	label_list="$(paste -sd ',' - <<<"$labels" | sed 's/,/, /g')"
	age="$(for_how_long $(($(date +%s) - $(epoch "$(jq -r .created_at "$WORK/pull.json")"))))"
	if [[ -n "$merged" ]]; then
		row winget "winget" waiting "[#$number]($url) merged; $WINGET's contents do not show it yet$others"
		return
	fi
	if [[ "$state" != "open" ]]; then
		row winget "winget" problem "[#$number]($url) was closed without merging$others"
		return
	fi
	needs_us="$(labels_needing_us <<<"$labels" | paste -sd ',' - | sed 's/,/, /g')"
	if [[ -n "$needs_us" ]]; then
		row winget "winget" problem "[#$number]($url) needs us: $needs_us$others"
		return
	fi
	if grep -qxE 'Moderator-Approved|Merge-Ready' <<<"$labels"; then
		stage="approved, waiting to merge"
	elif grep -qxE 'Validation-Completed|Azure-Pipeline-Passed' <<<"$labels"; then
		if grep -qx 'New-Package' <<<"$labels"; then
			stage="validated, waiting for a moderator to review the new package"
		else
			stage="validated, waiting to merge"
		fi
	else
		stage="in Microsoft's validation"
	fi
	row winget "winget" waiting "[#$number]($url), open for $age: $stage (labels: ${label_list:-none yet})$others"
}

# ─── All of it ───────────────────────────────────────────────────────────

check_release
check_signing_key
check_apt
check_yum
check_homebrew
check_winget
check_certificate

{
	echo "### Infrastructure agent $VERSION"
	echo
	echo "| Where | State | Details |"
	echo "| --- | --- | --- |"
	printf '%s\n' "${ROWS[@]}"
	echo
	echo "What each state means, and what to do about it: [RELEASING.md]($GUIDE)."
} >"$WORK/summary.md"

cat "$WORK/summary.md"
if [[ -n "${GITHUB_STEP_SUMMARY:-}" ]]; then
	cat "$WORK/summary.md" >>"$GITHUB_STEP_SUMMARY"
fi
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
	echo "version=$VERSION" >>"$GITHUB_OUTPUT"
	echo "latest=$([[ "$VERSION" == "$LATEST" ]] && echo true || echo false)" >>"$GITHUB_OUTPUT"
fi

if ((PROBLEMS > 0)); then
	exit 1
fi
