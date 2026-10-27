#!/usr/bin/env bash
#
# Gives the browsers of a job in the Playwright image the fonts an ubuntu
# runner has and the image lacks: copies this folder's fonts/ into the user's
# fonts, where fontconfig - and so Chromium and Firefox - finds them, builds
# their cache, and fails unless fontconfig then answers DejaVu for
# sans-serif, serif and monospace, as it does on the runner.
#
#   bash .github/actions/runner-fonts/install.sh
#
# The fonts go to $XDG_DATA_HOME/fonts (~/.local/share/fonts when unset), in
# a folder of their own; RUNNER_FONTS_TARGET names another place (tests). No
# root and no apt: the job runs as the runner's user, and apt is what the
# image is there to avoid (action.yml says why).

set -euo pipefail

FONTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/fonts"
TARGET="${RUNNER_FONTS_TARGET:-${XDG_DATA_HOME:-$HOME/.local/share}/fonts/oneuptime-runner-fonts}"

shopt -s nullglob
fonts=("$FONTS_DIR"/*.ttf)
shopt -u nullglob

if [[ ${#fonts[@]} -eq 0 ]]; then
	echo "::error title=Runner fonts::There are no fonts in ${FONTS_DIR}." >&2
	exit 1
fi

mkdir -p "$TARGET"
cp "${fonts[@]}" "$TARGET/"
fc-cache -f "$TARGET" >/dev/null

# What the runner's fontconfig answers for each generic family.
failed=0
for expected in "sans-serif=DejaVu Sans" "serif=DejaVu Serif" "monospace=DejaVu Sans Mono"; do
	generic="${expected%%=*}"
	family="${expected#*=}"
	answer="$(fc-match -f '%{family}' "$generic")"
	if [[ "$answer" == "$family" || "$answer" == "$family,"* ]]; then
		echo "${generic}: ${answer}"
	else
		echo "::error title=Runner fonts::fontconfig answers ${answer} for ${generic}, not ${family} as on the runner: the browsers would draw the page in fonts the runner does not use." >&2
		failed=1
	fi
done

exit "$failed"
