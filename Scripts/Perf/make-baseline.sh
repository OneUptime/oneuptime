#!/bin/bash
# A second source tree for A/B runs: packages/App, packages/Common and
# packages/Probe (and config.example.env) as of <commit>, written to <out>,
# with node_modules linked to this checkout's installs - the App's and the
# Probe's node_modules are folders of links whose Common points at the
# baseline's own Common - and the Dashboard's built bundle linked from this
# checkout, so both sides serve the same bundle. Both sides therefore run
# this checkout's dependency versions: compare commits with the same lock
# files.
#
# Then PERF_SOURCE=<out> runs that code: stack.sh app-restart,
# stack.sh probe-restart, in-app.sh, ab-stack.sh and ab-monitor.sh read it.
#
# Usage: make-baseline.sh [commit] [out]
#        (defaults: the merge base with origin/master, $PERF_DIR/baseline)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PERF_DIR="${PERF_DIR:-/tmp/oneuptime-perf}"
COMMIT="${1:-$(git -C "$REPO" merge-base HEAD origin/master)}"
OUT="${2:-$PERF_DIR/baseline}"

case "$OUT" in
  "" | "/" | "$REPO" | "$REPO"/*)
    echo "refusing to write the baseline to $OUT"
    exit 1
    ;;
esac

rm -rf "$OUT"
mkdir -p "$OUT"
git -C "$REPO" archive "$COMMIT" packages/App packages/Common packages/Probe config.example.env | tar -x -C "$OUT"
ln -s "$REPO/packages/Common/node_modules" "$OUT/packages/Common/node_modules"

link_modules() {
  local package="$1"
  mkdir -p "$OUT/packages/$package/node_modules"
  for entry in "$REPO/packages/$package/node_modules"/* "$REPO/packages/$package/node_modules"/.bin; do
    local name
    name=$(basename "$entry")
    if [ "$name" = "Common" ]; then
      ln -s ../../Common "$OUT/packages/$package/node_modules/Common"
    else
      ln -s "$entry" "$OUT/packages/$package/node_modules/$name"
    fi
  done
}

link_modules App
link_modules Probe

PUBLIC=packages/App/FeatureSet/Dashboard/public
if [ -d "$REPO/$PUBLIC/dist" ]; then
  ln -s "$REPO/$PUBLIC/dist" "$OUT/$PUBLIC/dist"
  ln -s "$REPO/$PUBLIC/sw.js" "$OUT/$PUBLIC/sw.js"
  for script in "$REPO/$PUBLIC/assets/js"/tailwind*.js; do
    if [ -e "$script" ] && [ ! -e "$OUT/$PUBLIC/assets/js/$(basename "$script")" ]; then
      ln -s "$script" "$OUT/$PUBLIC/assets/js/$(basename "$script")"
    fi
  done
fi

echo "baseline of $COMMIT in $OUT; run it with PERF_SOURCE=$OUT"
