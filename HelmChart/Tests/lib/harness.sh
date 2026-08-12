#!/usr/bin/env bash
#
# Shared harness for the Helm chart test suites in ../suites.
#
# Sourcing this file gives a suite:
#   * assertion helpers that keep a pass/fail tally (assert_eq, assert_present,
#     assert_absent) and a closing summary (harness_report)
#   * on-demand installs of helm / kubectl / kind / helm-unittest, so a suite
#     runs on a bare CI runner as well as on a laptop that already has them
#   * a KinD cluster (harness_start_cluster) that is created once and shared
#     with the other suites when run.sh is driving
#
# Suites stay runnable on their own -- `bash HelmChart/Tests/suites/lint.sh` --
# as well as through `bash HelmChart/Tests/run.sh`.

set -euo pipefail

HARNESS_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TESTS_DIR="$(cd "${HARNESS_LIB_DIR}/.." && pwd)"
HELM_CHART_DIR="$(cd "${TESTS_DIR}/../Public/oneuptime" && pwd)"
KUBERNETES_AGENT_CHART_DIR="$(cd "${TESTS_DIR}/../Public/kubernetes-agent" && pwd)"

SUITE_NAME="${SUITE_NAME:-$(basename "$0" .sh)}"

# run.sh points every suite at one cluster and cleans it up itself; a suite
# started on its own owns the cluster it creates.
HELM_TEST_CLUSTER="${HELM_TEST_CLUSTER:-oneuptime-helm-test}"
HELM_TEST_MANAGED_CLUSTER="${HELM_TEST_MANAGED_CLUSTER:-false}"
# Set KEEP_CLUSTER=true to leave the cluster up and poke at it after a failure.
KEEP_CLUSTER="${KEEP_CLUSTER:-false}"
# run.sh sets this to collect each suite's tally.
HELM_TEST_RESULTS_DIR="${HELM_TEST_RESULTS_DIR:-}"

KIND_VERSION="${KIND_VERSION:-v0.23.0}"
HELM_UNITTEST_VERSION="${HELM_UNITTEST_VERSION:-v0.5.1}"

PASSES=0
FAILURES=0

pass() {
    PASSES=$((PASSES + 1))
    echo "  PASS: $1"
}

fail() {
    FAILURES=$((FAILURES + 1))
    echo "  FAIL: $1"
}

assert_eq() {
    # assert_eq <description> <expected> <actual>
    if [ "$2" = "$3" ]; then
        pass "$1"
    else
        fail "$1"
        echo "        expected: [$2]"
        echo "        actual:   [$3]"
    fi
}

# The haystack goes in on a here-string rather than through `echo ... | grep`:
# grep stops reading at the first match, and the EPIPE that hands the writer
# turns a match into a failed pipeline under `set -o pipefail` -- which scored
# passing assertions as failures.
assert_present() {
    # assert_present <description> <haystack> <needle>
    if grep -qF -- "$3" <<<"$2"; then
        pass "$1"
    else
        fail "$1 (missing '$3')"
    fi
}

assert_absent() {
    # assert_absent <description> <haystack> <needle>
    if grep -qF -- "$3" <<<"$2"; then
        fail "$1 (found '$3')"
    else
        pass "$1"
    fi
}

harness_os() {
    uname | tr '[:upper:]' '[:lower:]'
}

harness_arch() {
    case "$(uname -m)" in
        x86_64 | amd64) echo "amd64" ;;
        aarch64 | arm64) echo "arm64" ;;
        *) uname -m ;;
    esac
}

harness_install_helm() {
    if command -v helm >/dev/null 2>&1; then
        return 0
    fi
    echo "Installing Helm..."
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
}

harness_install_unittest_plugin() {
    local plugins
    plugins="$(helm plugin list 2>/dev/null || true)"
    if grep -q '^unittest' <<<"$plugins"; then
        return 0
    fi
    echo "Installing helm-unittest ${HELM_UNITTEST_VERSION}..."
    helm plugin install https://github.com/helm-unittest/helm-unittest --version "$HELM_UNITTEST_VERSION"
}

harness_install_kubectl() {
    if command -v kubectl >/dev/null 2>&1; then
        return 0
    fi
    echo "Installing kubectl..."
    local release
    release="$(curl -sSL https://storage.googleapis.com/kubernetes-release/release/stable.txt)"
    curl -sSL -o kubectl "https://storage.googleapis.com/kubernetes-release/release/${release}/bin/$(harness_os)/$(harness_arch)/kubectl"
    sudo install -m 0755 kubectl /usr/local/bin/kubectl
    rm -f kubectl
}

harness_install_kind() {
    if command -v kind >/dev/null 2>&1; then
        return 0
    fi
    echo "Installing kind ${KIND_VERSION}..."
    curl -sSL -o kind "https://kind.sigs.k8s.io/dl/${KIND_VERSION}/kind-$(harness_os)-$(harness_arch)"
    sudo install -m 0755 kind /usr/local/bin/kind
    rm -f kind
}

harness_cluster_exists() {
    local clusters
    clusters="$(kind get clusters 2>/dev/null || true)"
    grep -qxF -- "$HELM_TEST_CLUSTER" <<<"$clusters"
}

harness_delete_cluster() {
    if [ "$KEEP_CLUSTER" = "true" ]; then
        echo "KEEP_CLUSTER=true, leaving cluster ${HELM_TEST_CLUSTER} running."
        return 0
    fi
    if command -v kind >/dev/null 2>&1 && harness_cluster_exists; then
        echo "Deleting KinD cluster ${HELM_TEST_CLUSTER}..."
        kind delete cluster --name "$HELM_TEST_CLUSTER" >/dev/null 2>&1 || true
    fi
}

# Brings up the cluster the cluster-backed suites share. Idempotent: the second
# suite to ask for it finds it already running.
harness_start_cluster() {
    harness_install_helm
    harness_install_kubectl
    harness_install_kind

    if ! harness_cluster_exists; then
        echo "Creating KinD cluster ${HELM_TEST_CLUSTER}..."
        kind create cluster --name "$HELM_TEST_CLUSTER" --wait 180s
    fi
    kubectl config use-context "kind-${HELM_TEST_CLUSTER}" >/dev/null

    # run.sh tears the shared cluster down once every suite has had its turn.
    if [ "$HELM_TEST_MANAGED_CLUSTER" != "true" ]; then
        trap harness_delete_cluster EXIT
    fi
}

harness_namespace() {
    # harness_namespace <namespace>
    kubectl create namespace "$1" >/dev/null 2>&1 || true
}

# Prints the suite tally, hands it to run.sh when there is one, and returns
# non-zero if anything failed -- call it as the last line of a suite.
harness_report() {
    echo
    echo "----------------------------------------------------------------------"
    if [ "$FAILURES" -eq 0 ]; then
        echo "  ${SUITE_NAME}: ${PASSES} passed"
    else
        echo "  ${SUITE_NAME}: ${PASSES} passed, ${FAILURES} failed"
    fi
    echo "----------------------------------------------------------------------"

    if [ -n "$HELM_TEST_RESULTS_DIR" ]; then
        mkdir -p "$HELM_TEST_RESULTS_DIR"
        printf '%s %s\n' "$PASSES" "$FAILURES" >"${HELM_TEST_RESULTS_DIR}/${SUITE_NAME}"
    fi

    [ "$FAILURES" -eq 0 ]
}
