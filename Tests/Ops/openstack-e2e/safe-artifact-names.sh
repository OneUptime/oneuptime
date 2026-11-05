#!/usr/bin/env bash
#
# Rename whatever an uploaded artifact cannot hold, so one file's name never costs a run
# its whole recording.
#
# actions/upload-artifact refuses a path with any of  " : < > | * ?  in it, and refuses the
# whole upload, not that file. A service can write such a name itself: oslo.log names a
# file after the top of its stack, and under uWSGI that is "<frozen importlib._bootstrap>",
# so Cinder's API writes "<frozen importlib._bootstrap>.log".
#
# Each of those characters becomes "_". A name that is taken already keeps a number.
#
# Usage: bash Tests/Ops/openstack-e2e/safe-artifact-names.sh <folder>

set -uo pipefail

ROOT="${1:?Usage: safe-artifact-names.sh <folder>}"
[ -d "$ROOT" ] || exit 0

# The deepest first, so renaming a folder never moves what is still to be renamed.
find "$ROOT" -depth -name '*[":<>|*?]*' -print0 | while IFS= read -r -d '' path; do
  folder="$(dirname "$path")"
  name="$(basename "$path")"
  safe="$(printf '%s' "$name" | tr '":<>|*?' '_______')"
  target="$folder/$safe"
  number=1
  while [ -e "$target" ]; do
    target="$folder/$number-$safe"
    number=$((number + 1))
  done
  mv "$path" "$target" && echo "Renamed for the upload: $name -> $(basename "$target")"
done

exit 0
