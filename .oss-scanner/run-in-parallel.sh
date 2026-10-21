#!/usr/bin/env bash
#
# Runs commands in several directories at once, for .oss-scanner/Dockerfile.
#
#   bash .oss-scanner/run-in-parallel.sh <jobs> <<'EOF'
#   packages/Probe npm run compile
#   agents/ResourceAIAgent npm run compile
#   EOF
#
# Each line of standard input is "<directory> <command...>", relative to the
# repository root; blank lines and lines starting with # are skipped. Up to
# <jobs> lines run at the same time. Every output line is prefixed with its
# directory, so the interleaved build log still says which project wrote it.
# Every line runs to the end even when another fails; the script then fails
# and names each line that failed.
#
# The image needs this because npm ci and tsc mostly use one core each, and
# the scanner gives the whole build 45 minutes on a 16-core machine.

set -euo pipefail

jobs="${1:-}"

if ! [[ "${jobs}" =~ ^[1-9][0-9]*$ ]]; then
  echo "usage: run-in-parallel.sh <jobs>, with lines of '<directory> <command...>' on stdin" >&2
  exit 2
fi

cd "$(dirname "${BASH_SOURCE[0]}")/.."

failures="$(mktemp)"
trap 'rm -f "${failures}"' EXIT

lines="$(grep -v -e '^[[:space:]]*$' -e '^[[:space:]]*#' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' || true)"

if [ -z "${lines}" ]; then
  echo "run-in-parallel.sh: nothing to run (no '<directory> <command...>' lines on stdin)" >&2
  exit 2
fi

# xargs -L 1 splits each line into words: a directory, then a command and its
# arguments. A line that fails is recorded and exits 1, so xargs keeps
# starting the others (only an exit of 255 would stop it) and exits 123 at
# the end. Trailing blanks would join a line to the next one under -L, which
# is why they are stripped above.
status=0
# The script is single-quoted on purpose: its variables are the inner bash's.
# shellcheck disable=SC2016
printf '%s\n' "${lines}" |
  FAILURES="${failures}" xargs -P "${jobs}" -L 1 bash -c '
    set -o pipefail
    directory="$1"
    shift
    if [ "$#" -eq 0 ]; then
      echo "${directory}: no command" >> "${FAILURES}"
      exit 1
    fi
    if (cd "${directory}" && "$@") 2>&1 | sed -u "s|^|[${directory}] |"; then
      echo "[${directory}] done: $*"
    else
      echo "${directory}: $*" >> "${FAILURES}"
      echo "[${directory}] FAILED: $*" >&2
      exit 1
    fi
  ' run-in-parallel || status=$?

if [ -s "${failures}" ]; then
  echo "" >&2
  echo "These failed (their output is above, each line prefixed with its directory):" >&2
  sed 's/^/  /' "${failures}" >&2
  exit 1
fi

if [ "${status}" -ne 0 ]; then
  echo "run-in-parallel.sh: xargs exited ${status} without recording a failed line" >&2
  exit "${status}"
fi
