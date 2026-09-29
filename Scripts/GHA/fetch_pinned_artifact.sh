#!/usr/bin/env bash

# Puts one pinned third-party artifact (a CLI binary, a provider zip, a plugin
# tarball) at <dest>/<name>, byte for byte the file whose sha256 is pinned in
# the repository.
#
#   fetch_pinned_artifact.sh --name <file> --sha256 <hex> --dest <dir> \
#       [--mode <octal>] --source <kind> <url> [--source <kind> <url>]...
#
# <kind> says what the URL serves:
#
#   file            the artifact itself
#   zip:<member>    a zip archive; the artifact is <member> inside it
#   tgz:<member>    a gzip tarball; the artifact is <member> inside it
#   deb:<path>      a Debian package; the artifact is <path> inside its data
#                   archive (as dpkg-deb lists it, e.g. ./usr/bin/tofu)
#
# Why this exists. CI used to download these straight from GitHub release
# assets in every job that needed them, and GitHub's release CDN answers
# 500/504 in bursts -- on 2026-09-21 alone the bursts failed Common Test
# (gomplate, via test-setup.sh), a Build Preinstall (gomplate), the Terraform
# E2E "Setup OpenTofu" step on master, and helm-unittest's install. Each of
# those downloads had a retry window of 11 to 54 seconds, shorter than the
# bursts. The fix is to stop depending on the CDN at a moment's notice:
#
#   * The pin is a sha256 checked into the repository, never one fetched from
#     the same release. A file that matches it is the file -- so a copy the
#     caller restored from the Actions cache is used as is and the network is
#     never touched, and a truncated download or an HTML error page saved
#     under the binary's name can never be installed.
#   * On a miss every source is tried in order: the canonical release first,
#     then any mirror the caller knows serves the same bytes (the pin is of
#     the artifact, not of the archive, so a .deb from a package mirror
#     verifies against the same digest as the release .zip).
#   * curl's own retries back off exponentially (1s, 2s, 4s, ...). The fixed
#     `--retry-delay` the old downloads used is deliberately absent: setting it
#     replaces the backoff with a constant, which is how a 15-second window
#     came about. Rounds over all the sources are separated by
#     FETCH_PINNED_ARTIFACT_ROUND_DELAYS, so a miss rides out a burst of
#     several minutes before failing -- loudly, naming every source.
#
# Callers persist <dest> with actions/cache keyed on the pin, so the network is
# only used when a pin changes or the cache entry was evicted.

set -euo pipefail

# Seconds to wait between rounds over all the sources, space separated; the
# count also sets the number of rounds (delays + 1). A string so it can be
# overridden from the environment: Scripts/GHA/Tests zeroes it.
FETCH_PINNED_ARTIFACT_ROUND_DELAYS="${FETCH_PINNED_ARTIFACT_ROUND_DELAYS-30 90}"
# curl's own retries per request, backing off 1s, 2s, 4s, ... (6 => ~63s).
FETCH_PINNED_ARTIFACT_CURL_RETRIES="${FETCH_PINNED_ARTIFACT_CURL_RETRIES-6}"

usage() {
	echo "usage: $(basename "$0") --name <file> --sha256 <hex> --dest <dir> [--mode <octal>] --source <kind> <url> [--source <kind> <url>]..." >&2
	echo "  <kind>: file | zip:<member> | tgz:<member> | deb:<path>" >&2
	exit 2
}

log() {
	echo "fetch_pinned_artifact: ${NAME:-?}: $*" >&2
}

sha256_of() {
	if command -v sha256sum >/dev/null 2>&1; then
		sha256sum "$1" | cut -d ' ' -f 1
	else
		shasum -a 256 "$1" | cut -d ' ' -f 1
	fi
}

matches_pin() {
	[[ -f "$1" && -s "$1" ]] && [[ "$(sha256_of "$1")" == "$SHA256" ]]
}

NAME=""
SHA256=""
DEST=""
MODE="0644"
SOURCE_KINDS=()
SOURCE_URLS=()

while [[ $# -gt 0 ]]; do
	case "$1" in
	--name)
		[[ $# -ge 2 ]] || usage
		NAME="$2"
		shift 2
		;;
	--sha256)
		[[ $# -ge 2 ]] || usage
		SHA256="$(tr '[:upper:]' '[:lower:]' <<<"$2")"
		shift 2
		;;
	--dest)
		[[ $# -ge 2 ]] || usage
		DEST="$2"
		shift 2
		;;
	--mode)
		[[ $# -ge 2 ]] || usage
		MODE="$2"
		shift 2
		;;
	--source)
		[[ $# -ge 3 ]] || usage
		SOURCE_KINDS+=("$2")
		SOURCE_URLS+=("$3")
		shift 3
		;;
	*)
		echo "fetch_pinned_artifact: unknown argument '$1'" >&2
		usage
		;;
	esac
done

[[ -n "$NAME" && -n "$DEST" && ${#SOURCE_URLS[@]} -gt 0 ]] || usage
if [[ ! "$SHA256" =~ ^[0-9a-f]{64}$ ]]; then
	echo "fetch_pinned_artifact: --sha256 must be 64 hex characters, got '${SHA256}'" >&2
	exit 2
fi
if [[ ! "$MODE" =~ ^[0-7]{3,4}$ ]]; then
	echo "fetch_pinned_artifact: --mode must be an octal file mode like 0755, got '${MODE}'" >&2
	exit 2
fi
if [[ ! "$FETCH_PINNED_ARTIFACT_CURL_RETRIES" =~ ^[0-9]+$ ]]; then
	echo "fetch_pinned_artifact: FETCH_PINNED_ARTIFACT_CURL_RETRIES must be a number, got '${FETCH_PINNED_ARTIFACT_CURL_RETRIES}'" >&2
	exit 2
fi
if [[ "$NAME" == */* ]]; then
	echo "fetch_pinned_artifact: --name is a file name inside --dest, not a path: '${NAME}'" >&2
	exit 2
fi
for kind in "${SOURCE_KINDS[@]}"; do
	case "$kind" in
	file | zip:?* | tgz:?* | deb:?*) ;;
	*)
		echo "fetch_pinned_artifact: unknown source kind '${kind}' (file | zip:<member> | tgz:<member> | deb:<path>)" >&2
		exit 2
		;;
	esac
done

mkdir -p "$DEST"
TARGET="${DEST}/${NAME}"

if matches_pin "$TARGET"; then
	if ! chmod "$MODE" "$TARGET" 2>/dev/null; then
		# Another user's file (a cache someone once filled with sudo): fine as
		# long as it is already usable the way it was asked for.
		if [[ $((8#$MODE & 8#111)) -ne 0 && ! -x "$TARGET" ]]; then
			log "cached copy matches the pinned sha256 but is not executable, and chmod ${MODE} is not permitted"
			exit 1
		fi
		log "cannot chmod ${TARGET} (not owned by $(id -un)); using it with its current mode"
	fi
	log "cached copy matches the pinned sha256; nothing to download"
	exit 0
fi
if [[ -e "$TARGET" ]]; then
	# Left in place until then: the rename below replaces it atomically, so a
	# concurrent run never sees it missing.
	log "the copy at ${TARGET} does not match the pinned sha256; replacing it"
fi

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Timeouts. A stall (under 10 KB/s for 30s) ends the attempt and is retried
# like any other failure, rather than holding it until a hard cap; --max-time
# only bounds a transfer that keeps crawling. Retries stop being started after
# --retry-max-time.
CURL_ARGS=(--connect-timeout 20 --speed-limit 10240 --speed-time 30 --max-time 300
	--retry "$FETCH_PINNED_ARTIFACT_CURL_RETRIES" --retry-max-time 180)
# --retry-all-errors (curl >= 7.71) also retries a connection reset mid-read,
# which is otherwise final; an older curl rejects the option outright and would
# fail every download, so it is only passed when understood. It has to come
# before --version, which stops option parsing.
if curl --retry-all-errors --version >/dev/null 2>&1; then
	CURL_ARGS+=(--retry-all-errors)
else
	log "this curl predates --retry-all-errors (7.71); only its transient errors (timeouts, 408/429/5xx) are retried"
fi

# download <url> <out>
download() {
	curl --fail --location --silent --show-error "${CURL_ARGS[@]}" --output "$2" "$1"
}

# extract <kind> <package> <out>: writes the artifact the package holds to <out>.
extract() {
	local kind="$1" package="$2" out="$3"
	case "$kind" in
	file)
		mv "$package" "$out"
		;;
	zip:*)
		unzip -p "$package" "${kind#zip:}" >"$out"
		;;
	tgz:*)
		tar -xzOf "$package" "${kind#tgz:}" >"$out"
		;;
	deb:*)
		if ! command -v dpkg-deb >/dev/null 2>&1; then
			log "dpkg-deb is not installed, so a .deb source cannot be unpacked here"
			return 1
		fi
		dpkg-deb --fsys-tarfile "$package" | tar -xOf - "${kind#deb:}" >"$out"
		;;
	esac
}

# try_source <kind> <url>: 0 once TARGET holds the pinned artifact.
try_source() {
	local kind="$1" url="$2"
	local package="${WORK}/package" candidate="${WORK}/candidate"
	rm -f "$package" "$candidate"

	log "fetching ${url}"
	if ! download "$url" "$package"; then
		log "download failed: ${url}"
		return 1
	fi
	if ! extract "$kind" "$package" "$candidate"; then
		log "could not take ${kind} out of what ${url} served"
		return 1
	fi
	if ! matches_pin "$candidate"; then
		local actual="(empty)"
		[[ -s "$candidate" ]] && actual="$(sha256_of "$candidate")"
		log "what ${url} served does not match the pinned sha256 (got ${actual}, pinned ${SHA256})"
		return 1
	fi

	# Same directory, then rename: a concurrent reader never sees half a file.
	# Each step is checked, and the copy is verified again after the write: this
	# function runs as an `if` condition, where errexit does not apply, and a
	# full disk or an unwritable --dest must not leave a truncated file behind
	# under the artifact's name -- let alone report it installed, for a caller
	# to save into the Actions cache under the pin's key. That is a local
	# failure another round cannot fix, so it ends the run.
	local staged=""
	if ! staged="$(mktemp "${DEST}/.${NAME}.partial.XXXXXX")" ||
		! { cp "$candidate" "$staged" && chmod "$MODE" "$staged" && matches_pin "$staged" && mv -f "$staged" "$TARGET"; }; then
		[[ -n "$staged" ]] && rm -f "$staged"
		log "verified ${url}, but could not install it at ${TARGET} (is ${DEST} writable, with space free?)"
		exit 1
	fi
	log "installed ${TARGET} (sha256 ${SHA256}) from ${url}"
	return 0
}

delays=()
read -ra delays <<<"$FETCH_PINNED_ARTIFACT_ROUND_DELAYS" || true
rounds=$((${#delays[@]} + 1))

for ((round = 1; round <= rounds; round++)); do
	for i in "${!SOURCE_URLS[@]}"; do
		if try_source "${SOURCE_KINDS[$i]}" "${SOURCE_URLS[$i]}"; then
			exit 0
		fi
	done
	if ((round < rounds)); then
		delay="${delays[round - 1]}"
		log "no source produced the pinned artifact in round ${round}/${rounds}; trying again in ${delay}s"
		sleep "$delay"
	fi
done

message="no source produced an artifact matching sha256 ${SHA256} after ${rounds} round(s): ${SOURCE_URLS[*]}"
if [[ "${GITHUB_ACTIONS:-}" == "true" ]]; then
	echo "::error title=Pinned download failed::${NAME}: ${message}" >&2
fi
log "$message"
exit 1
