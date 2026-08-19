#!/usr/bin/env bash
#
# Runs the Helm chart test suites in ./suites -- this is what the "helm-test"
# CI job calls.
#
#   bash HelmChart/Tests/run.sh                        # every suite
#   bash HelmChart/Tests/run.sh lint unit              # only these two
#   KEEP_CLUSTER=true bash HelmChart/Tests/run.sh      # keep KinD up to debug
#
# Suites run cheapest-first, so a broken template fails before anything spends a
# minute booting a cluster. The cluster-backed suites share a single KinD
# cluster: this script hands them the name and deletes it once the run is over.
# Each suite is a separate process, so one blowing up still leaves the rest to
# run and report.

set -uo pipefail

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUITES_DIR="${TESTS_DIR}/suites"

# Ordered cheapest-first. Every file in ./suites has to appear here, which is
# checked below: a new suite cannot be added and then silently never run.
ALL_SUITES=(lint unit secrets-lifecycle keda-bootstrap)

usage() {
    echo "usage: $(basename "${BASH_SOURCE[0]}") [suite ...]"
    echo "suites: ${ALL_SUITES[*]}"
}

for file in "${SUITES_DIR}"/*.sh; do
    name="$(basename "$file" .sh)"
    listed=false
    for suite in "${ALL_SUITES[@]}"; do
        if [ "$suite" = "$name" ]; then
            listed=true
            break
        fi
    done
    if [ "$listed" != "true" ]; then
        echo "Suite '${name}' is missing from ALL_SUITES in $(basename "${BASH_SOURCE[0]}"); add it there so it runs." >&2
        exit 1
    fi
done

if [ "$#" -gt 0 ]; then
    case "$1" in
        -h | --help)
            usage
            exit 0
            ;;
    esac
    SELECTED=("$@")
else
    SELECTED=("${ALL_SUITES[@]}")
fi

for suite in "${SELECTED[@]}"; do
    if [ ! -f "${SUITES_DIR}/${suite}.sh" ]; then
        echo "Unknown suite '${suite}'." >&2
        usage >&2
        exit 1
    fi
done

export HELM_TEST_CLUSTER="${HELM_TEST_CLUSTER:-oneuptime-helm-test}"
export HELM_TEST_MANAGED_CLUSTER=true
export KEEP_CLUSTER="${KEEP_CLUSTER:-false}"

RESULTS_DIR="$(mktemp -d)"
export HELM_TEST_RESULTS_DIR="$RESULTS_DIR"

cleanup() {
    rm -rf "$RESULTS_DIR"

    if [ "$KEEP_CLUSTER" = "true" ]; then
        echo "KEEP_CLUSTER=true, leaving cluster ${HELM_TEST_CLUSTER} running."
        return 0
    fi
    if ! command -v kind >/dev/null 2>&1; then
        return 0
    fi
    local clusters
    clusters="$(kind get clusters 2>/dev/null || true)"
    if grep -qxF -- "$HELM_TEST_CLUSTER" <<<"$clusters"; then
        echo "Deleting KinD cluster ${HELM_TEST_CLUSTER}..."
        kind delete cluster --name "$HELM_TEST_CLUSTER" >/dev/null 2>&1 || true
    fi
}
trap cleanup EXIT

SUMMARY=()
FAILED=0

for suite in "${SELECTED[@]}"; do
    echo
    echo "======================================================================"
    echo "  suite: ${suite}"
    echo "======================================================================"

    SUITE_NAME="$suite" bash "${SUITES_DIR}/${suite}.sh"
    status=$?

    if [ ! -f "${RESULTS_DIR}/${suite}" ]; then
        # The suite died before it could report -- a helm install that failed, a
        # cluster that never came up.
        SUMMARY+=("$(printf '  %-6s %-20s did not finish (exit %s)' "FAIL" "$suite" "$status")")
        FAILED=$((FAILED + 1))
        continue
    fi

    read -r passed failed <"${RESULTS_DIR}/${suite}"
    if [ "$status" -ne 0 ] || [ "$failed" -ne 0 ]; then
        SUMMARY+=("$(printf '  %-6s %-20s %s passed, %s failed' "FAIL" "$suite" "$passed" "$failed")")
        FAILED=$((FAILED + 1))
    else
        SUMMARY+=("$(printf '  %-6s %-20s %s passed' "PASS" "$suite" "$passed")")
    fi
done

echo
echo "======================================================================"
echo "  Helm chart tests"
echo "======================================================================"
for line in "${SUMMARY[@]}"; do
    echo "$line"
done
echo "======================================================================"

if [ "$FAILED" -ne 0 ]; then
    echo "  ${FAILED} of ${#SELECTED[@]} suites failed."
    exit 1
fi

echo "  All ${#SELECTED[@]} suites passed."
