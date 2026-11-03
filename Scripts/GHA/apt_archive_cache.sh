#!/usr/bin/env bash

# Keeps the Debian packages a job installs with apt, so its next run on the
# same runner image installs them from the Actions cache instead of the
# runner's Ubuntu mirror.
#
#   apt_archive_cache.sh image                       # prints image=<id>
#   apt_archive_cache.sh keep <archives>             # keep what apt fetches
#   apt_archive_cache.sh save <archives> <cache>     # copy it out to cache
#   apt_archive_cache.sh install <cache>             # install from cache
#
# Why this exists. The Probe's job installs Chromium's and Firefox's system
# packages and fonts (`npx playwright install --with-deps`, about 54 MB) and
# strace from the runner's Ubuntu mirror, which serves some runners at a few
# dozen kB/s: 11 minutes on master on 2026-10-26, and still going at 19 on
# another run that day. The other browser jobs moved into the Playwright
# image (Tests/Ops/PlaywrightImage), which has the browsers' packages; the
# Probe's suite needs strace and gcc as well, which the image lacks, so it
# stays on the runner, and this caches what it fetches.
#
#   * `image` names the runner image (ImageOS and ImageVersion, which GitHub's
#     hosted runners set, and the machine): the packages a cache holds are
#     what that image lacks, so the cache key carries it. Where the two are
#     not set, it names this run alone - so the cache never hits - rather
#     than share packages between images it cannot tell apart.
#   * `keep` makes apt keep every package it downloads from here on in
#     <archives> (an apt.conf.d drop-in: Dir::Cache::Archives, and
#     Keep-Downloaded-Packages for apt and apt-get alike), with the partial
#     folder apt's sandboxed downloader (_apt) writes to, as apt makes its own.
#     A folder of its own, so no clean-up hook aimed at
#     /var/cache/apt/archives empties it.
#   * `save` copies the packages apt downloaded into <cache>, which the job
#     then saves with actions/cache, with a list of them (packages.txt: name,
#     version and file). A run that downloaded nothing saves an empty list:
#     the image lacked nothing.
#   * `install` installs <cache>'s packages with apt-get, from the files,
#     with no package source at all (no sources.list, an empty list folder),
#     so apt plans the whole install from them and the packages already
#     installed, and stops before it changes anything when a package needs
#     one neither has (a cache that is not this image's). It exits non-zero
#     then, and the job falls back to the mirror as before. It never asks the
#     mirror for anything. (apt-get's --no-download fails on package files:
#     "Pathname to install is not absolute".)
#
# Run as the runner's user: the commands that need root go through sudo.

set -euo pipefail

# Where `keep` writes its apt configuration. Scripts/GHA/Tests points it at a
# folder of their own.
APT_CONF_DIR="${APT_ARCHIVE_CACHE_APT_CONF_DIR:-/etc/apt/apt.conf.d}"
DROP_IN_NAME="90-oneuptime-keep-downloaded-packages"
LIST_NAME="packages.txt"

usage() {
	echo "usage: $(basename "$0") image | keep <archives> | save <archives> <cache> | install <cache>" >&2
	exit 2
}

log() {
	echo "apt_archive_cache: $*" >&2
}

# The user apt downloads as, when it exists, else root.
download_user() {
	if id -u _apt >/dev/null 2>&1; then
		echo "_apt"
	else
		echo "root"
	fi
}

cmd_image() {
	local machine
	machine="$(uname -m)"

	if [[ -n "${ImageOS:-}" && -n "${ImageVersion:-}" ]]; then
		echo "image=${ImageOS}-${ImageVersion}-${machine}"
	else
		# Not a runner image this can name: a key no other run shares.
		echo "image=unnamed-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${machine}"
	fi
}

cmd_keep() {
	local archives="$1"
	local owner
	owner="${APT_ARCHIVE_CACHE_PARTIAL_OWNER:-$(download_user)}"

	sudo install -d -m 755 "$archives"
	sudo install -d -o "$owner" -m 700 "${archives}/partial"
	sudo install -d -m 755 "$APT_CONF_DIR"
	printf '%s\n' \
		"// Written by Scripts/GHA/apt_archive_cache.sh: keep every package apt" \
		"// downloads, in a folder of its own, for the Actions cache." \
		"Dir::Cache::Archives \"${archives}/\";" \
		'APT::Keep-Downloaded-Packages "true";' \
		'Binary::apt::APT::Keep-Downloaded-Packages "true";' \
		'Binary::apt-get::APT::Keep-Downloaded-Packages "true";' |
		sudo tee "${APT_CONF_DIR}/${DROP_IN_NAME}" >/dev/null
	log "apt keeps what it downloads in ${archives}"
}

cmd_save() {
	local archives="$1" cache="$2"
	local count=0 deb

	mkdir -p "$cache"
	rm -f "$cache"/*.deb "${cache}/${LIST_NAME}"
	: >"${cache}/${LIST_NAME}"

	shopt -s nullglob
	for deb in "$archives"/*.deb; do
		cp "$deb" "$cache/"
		printf '%s %s %s\n' \
			"$(dpkg-deb --field "$deb" Package)" \
			"$(dpkg-deb --field "$deb" Version)" \
			"$(basename "$deb")" >>"${cache}/${LIST_NAME}"
		count=$((count + 1))
	done
	shopt -u nullglob

	sort -o "${cache}/${LIST_NAME}" "${cache}/${LIST_NAME}"
	log "kept ${count} package(s) for the next run on this image"
}

cmd_install() {
	local cache="$1"
	local debs=()

	if [[ ! -f "${cache}/${LIST_NAME}" ]]; then
		log "no ${LIST_NAME} in ${cache}: nothing this script saved"
		return 1
	fi

	shopt -s nullglob
	debs=("$cache"/*.deb)
	shopt -u nullglob

	local listed
	listed="$(grep -c . "${cache}/${LIST_NAME}" || true)"

	if [[ "${#debs[@]}" -ne "$listed" ]]; then
		log "${cache} holds ${#debs[@]} package(s) but lists ${listed}: not installing it"
		return 1
	fi

	if [[ "${#debs[@]}" -eq 0 ]]; then
		log "the cache lists nothing: this image lacked nothing"
		return 0
	fi

	# Paths with a slash, so apt reads each as a package file.
	local files=() deb
	for deb in "${debs[@]}"; do
		files+=("$(cd "$(dirname "$deb")" && pwd)/$(basename "$deb")")
	done

	# No source to download from: the cache and the installed packages only.
	local empty
	empty="$(mktemp -d)"
	mkdir -p "${empty}/lists/partial" "${empty}/sources.list.d"
	: >"${empty}/sources.list"

	local status=0
	sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
		--no-install-recommends \
		-o Dir::Etc::SourceList="${empty}/sources.list" \
		-o Dir::Etc::SourceParts="${empty}/sources.list.d" \
		-o Dir::State::Lists="${empty}/lists" \
		"${files[@]}" || status=$?
	rm -rf "$empty"

	if [[ "$status" -ne 0 ]]; then
		log "apt would not install the cached packages alone; install them from the mirror instead"
		return 1
	fi

	log "installed ${#debs[@]} package(s) from the cache"
}

[[ $# -ge 1 ]] || usage

case "$1" in
image)
	[[ $# -eq 1 ]] || usage
	cmd_image
	;;
keep)
	[[ $# -eq 2 ]] || usage
	cmd_keep "$2"
	;;
save)
	[[ $# -eq 3 ]] || usage
	cmd_save "$2" "$3"
	;;
install)
	[[ $# -eq 2 ]] || usage
	cmd_install "$2"
	;;
*)
	usage
	;;
esac
