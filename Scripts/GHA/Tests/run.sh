#!/usr/bin/env bash
#
# Runs the tests for the release shell scripts in Scripts/GHA -- this is what
# the "gha-scripts-test" CI job calls.
#
#   bash Scripts/GHA/Tests/run.sh                  # every suite
#   bash Scripts/GHA/Tests/run.sh retry            # only this one
#
# Nothing here talks to a registry: the syft the suites put on PATH is a stub,
# and the retry delays are overridden to zero. A full run is seconds.
#
# Every *_test.sh in this directory is picked up automatically, so a new suite
# runs as soon as it is added. Each suite is a separate process, so one blowing
# up still leaves the rest to run and report.

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

SUITES=()
for file in "${TESTS_DIR}"/*_test.sh; do
	[[ -e "$file" ]] || continue
	SUITES+=("$(basename "$file" _test.sh)")
done

if [[ ${#SUITES[@]} -eq 0 ]]; then
	echo "No *_test.sh files found in ${TESTS_DIR}" >&2
	exit 1
fi

if [[ "$#" -gt 0 ]]; then
	for requested in "$@"; do
		if [[ ! -f "${TESTS_DIR}/${requested}_test.sh" ]]; then
			echo "Unknown suite '${requested}'. Available: ${SUITES[*]}" >&2
			exit 1
		fi
	done
	SUITES=("$@")
fi

FAILED=()

for suite in "${SUITES[@]}"; do
	echo ""
	echo "── ${suite} ──────────────────────────────────────────"
	if ! bash "${TESTS_DIR}/${suite}_test.sh"; then
		FAILED+=("$suite")
	fi
done

echo ""
if [[ ${#FAILED[@]} -gt 0 ]]; then
	echo "❌ Failed suites: ${FAILED[*]}" >&2
	exit 1
fi

echo "✅ All suites passed: ${SUITES[*]}"
