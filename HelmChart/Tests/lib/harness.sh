#!/usr/bin/env bash
#
# Shared harness for the Helm chart test suites in ../suites.
#
# Sourcing this file gives a suite:
#   * assertion helpers that keep a pass/fail tally (assert_eq, assert_present,
#     assert_absent) and a closing summary (harness_report)
#   * on-demand installs of helm / kubectl / kind / helm-unittest, so a suite
#     runs on a bare CI runner as well as on a laptop that already has them
#     (helm-unittest from a sha256-pinned tarball kept in a local cache, see
#     harness_install_unittest_plugin)
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
# The one place the helm-unittest version is set. Its release tarballs are
# pinned by sha256 in harness_unittest_sha256, and a version with no pins there
# fails the helm-test job -- and the unit suite, wherever it has to install the
# plugin -- instead of installing something unverified.
HELM_UNITTEST_VERSION="${HELM_UNITTEST_VERSION:-v0.5.1}"
# Where the verified helm-unittest tarball is kept between runs. The helm-test
# CI job points it at a directory it persists with actions/cache.
HELM_UNITTEST_CACHE_DIR="${HELM_UNITTEST_CACHE_DIR:-${XDG_CACHE_HOME:-${HOME}/.cache}/oneuptime/helm-unittest}"

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

# helm-unittest ships one tarball per platform: the `untt` binary beside a
# plugin.yaml whose command is "$HELM_PLUGIN_DIR/untt". This used to be
# `helm plugin install <repo> --version`, which clones the repository and then
# runs the plugin's install hook -- a script that downloads that tarball and
# its checksum file from GitHub's release CDN with a single, unretried curl.
# The CDN answers 500/504 in bursts, and on 2026-09-21 one of them failed the
# helm-test job.
#
# Now the tarball is pinned by sha256 below and fetched into
# HELM_UNITTEST_CACHE_DIR by Scripts/GHA/fetch_pinned_artifact.sh, which uses a
# copy that still matches the pin without touching the network, and otherwise
# rides out a burst with exponential backoff. It is then unpacked straight into
# helm's plugin directory -- the layout the hook would have produced. Hooks
# only run on `helm plugin install/update`, never when helm loads a plugin, so
# nothing else is downloaded. The helm-test job persists the cache directory
# with actions/cache, so on a warm cache CI never asks GitHub for it.

# This machine as helm-unittest's release names it: <os>-<arch>, with macOS as
# "macos".
harness_unittest_platform() {
    local os
    os="$(harness_os)"
    if [ "$os" = "darwin" ]; then
        os="macos"
    fi
    echo "${os}-$(harness_arch)"
}

# harness_unittest_sha256 <version> <platform>: the pinned sha256 of
# helm-unittest-<platform>-<version without the v>.tgz, or nothing.
#
# Copied from helm-unittest-checksum.sha in the version's GitHub release, and
# each one checked against a download of its tarball -- never read at run time
# from the release it is meant to verify. CI runs on linux-amd64, so every
# version listed must pin that; the others spare a laptop the CDN too. A
# platform with no pin (Windows, 32-bit) falls back to `helm plugin install`.
harness_unittest_sha256() {
    case "$1/$2" in
        v0.5.1/linux-amd64) echo "1b6cd770b19be4bfdca8f501b8b7292b27a771fffec0a072316125caf6c6b0e9" ;;
        v0.5.1/linux-arm64) echo "cdd7a646a9160e7fa6444ebeb9148650e2e9bd44122dd16fb8dc5e893a12262a" ;;
        v0.5.1/macos-amd64) echo "169266022ed5a5f50077b881d06bb3016477070018eaaa7d2f1999c056c6719c" ;;
        v0.5.1/macos-arm64) echo "bb3e00fad119238ca4b8ddd659f3d43aa31e731f21d71ec162455d69e0e18e1f" ;;
    esac
}

# Fails -- before anything is downloaded -- when HELM_UNITTEST_VERSION was
# changed without pinning the new version's tarballs.
harness_unittest_require_pins() {
    if [ -n "$(harness_unittest_sha256 "$HELM_UNITTEST_VERSION" linux-amd64)" ]; then
        return 0
    fi
    local message="HELM_UNITTEST_VERSION is ${HELM_UNITTEST_VERSION}, but HelmChart/Tests/lib/harness.sh pins no helm-unittest tarball for that version. Add its digests to harness_unittest_sha256 in the same change (from helm-unittest-checksum.sha in the release, each checked against a download of the tarball)."
    if [ "${GITHUB_ACTIONS:-}" = "true" ]; then
        echo "::error title=helm-unittest pin is stale::${message}" >&2
    fi
    echo "$message" >&2
    return 1
}

# Prints this machine's pin as key=value lines for $GITHUB_OUTPUT: the
# helm-test CI job keys its actions/cache entry on them. Fails when there is no
# pin for this machine -- CI must never take the unpinned fallback.
harness_unittest_pin() {
    harness_unittest_require_pins || return 1
    local platform sha256
    platform="$(harness_unittest_platform)"
    sha256="$(harness_unittest_sha256 "$HELM_UNITTEST_VERSION" "$platform")"
    if [ -z "$sha256" ]; then
        echo "HelmChart/Tests/lib/harness.sh pins no helm-unittest ${HELM_UNITTEST_VERSION} tarball for ${platform}; add one to harness_unittest_sha256." >&2
        return 1
    fi
    echo "version=${HELM_UNITTEST_VERSION}"
    echo "platform=${platform}"
    echo "sha256=${sha256}"
    echo "dir=${HELM_UNITTEST_CACHE_DIR}"
}

# Puts the pinned tarball for this machine in HELM_UNITTEST_CACHE_DIR and prints
# its path, or prints nothing when this platform has no pin. Needs no helm, so
# the helm-test CI job also runs it as a step of its own, to fill its cache
# before any suite gets the chance to fail.
harness_fetch_unittest_plugin() {
    harness_unittest_require_pins || return 1
    local platform sha256 name
    platform="$(harness_unittest_platform)"
    sha256="$(harness_unittest_sha256 "$HELM_UNITTEST_VERSION" "$platform")"
    if [ -z "$sha256" ]; then
        return 0
    fi
    name="helm-unittest-${platform}-${HELM_UNITTEST_VERSION#v}.tgz"
    # Its progress goes to stderr: stdout is for the path.
    bash "${TESTS_DIR}/../../Scripts/GHA/fetch_pinned_artifact.sh" \
        --name "$name" \
        --sha256 "$sha256" \
        --dest "$HELM_UNITTEST_CACHE_DIR" \
        --source file "https://github.com/helm-unittest/helm-unittest/releases/download/${HELM_UNITTEST_VERSION}/${name}" \
        >&2 || return 1
    echo "${HELM_UNITTEST_CACHE_DIR}/${name}"
}

harness_install_unittest_plugin() {
    local plugins installed
    plugins="$(helm plugin list 2>/dev/null || true)"
    installed="$(awk '$1 == "unittest" { print $2; exit }' <<<"$plugins")"
    if [ -n "$installed" ]; then
        if [ "$installed" != "${HELM_UNITTEST_VERSION#v}" ]; then
            echo "Using the helm-unittest ${installed} already installed (the harness pins ${HELM_UNITTEST_VERSION})."
        fi
        return 0
    fi

    local plugins_dir tarball staging
    plugins_dir="$(helm env HELM_PLUGINS)"
    # HELM_PLUGINS can list several directories; the first one will do.
    plugins_dir="${plugins_dir%%:*}"
    # -L as well as -e: helm up to at least 3.12 installed a VCS plugin as a
    # symlink into its cache, which dangles once that cache is cleared.
    if [ -e "${plugins_dir}/helm-unittest" ] || [ -L "${plugins_dir}/helm-unittest" ]; then
        echo "${plugins_dir}/helm-unittest exists, but helm does not list a unittest plugin. Remove it and run again." >&2
        return 1
    fi

    tarball="$(harness_fetch_unittest_plugin)" || return 1
    if [ -z "$tarball" ]; then
        echo "No pinned helm-unittest for $(harness_unittest_platform); installing ${HELM_UNITTEST_VERSION} with \`helm plugin install\`, straight from GitHub..."
        helm plugin install https://github.com/helm-unittest/helm-unittest --version "$HELM_UNITTEST_VERSION"
        return 0
    fi

    echo "Installing helm-unittest ${HELM_UNITTEST_VERSION} from ${tarball}..."
    mkdir -p "$plugins_dir"
    # Unpacked a level deeper and then renamed into place: helm only loads
    # <plugins>/*/plugin.yaml, so an interrupted unpack is never picked up.
    staging="$(mktemp -d "${plugins_dir}/.helm-unittest-install.XXXXXX")"
    mkdir "${staging}/helm-unittest"
    if ! tar -xzf "$tarball" -C "${staging}/helm-unittest"; then
        rm -rf "$staging"
        return 1
    fi
    mv "${staging}/helm-unittest" "${plugins_dir}/helm-unittest"
    rmdir "$staging"

    plugins="$(helm plugin list 2>&1 || true)"
    installed="$(awk '$1 == "unittest" { print $2; exit }' <<<"$plugins")"
    if [ "$installed" != "${HELM_UNITTEST_VERSION#v}" ]; then
        echo "Unpacked helm-unittest into ${plugins_dir}/helm-unittest, but helm lists unittest '${installed}' rather than ${HELM_UNITTEST_VERSION#v}:" >&2
        echo "$plugins" >&2
        return 1
    fi
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
