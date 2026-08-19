#!/usr/bin/env bash
#
# Cluster-backed tests for the KEDA CRD bootstrap and the install/enabled split.
#
# This is the only suite that can see the bug it covers. `helm template` and
# helm-unittest both run through Helm's fake kube client, whose Build() returns
# an empty list unconditionally -- so a manifest that the API server will reject
# for an unresolvable kind renders perfectly clean there. The chart shipped for
# months with a first install that could not succeed, and lint, unit tests and
# the release job's `helm template` all stayed green throughout.
#
# The bundled KEDA subchart ships its CRDs as ordinary templates (templates/crds,
# gated by crds.install) rather than in a crds/ directory. Only a crds/ directory
# is applied by Helm before it resolves the rendered manifest against the API
# server, so with the CRDs as templates the chart's own ScaledObject cannot be
# mapped on a cluster that has no KEDA, and the whole install aborts before
# anything is applied. Hence `keda.install`, which turns the operator into its
# own switch: one pass installs it, the next renders the custom resources.
#
# Covered:
#   1. The premise. A single-pass install with KEDA autoscaling on a cluster with
#      no KEDA fails on the resource mapping, and applies nothing at all.
#   2. The bootstrap pass (install on, enabled off) installs the operator and its
#      CRDs and renders no custom resource.
#   3. The second pass then renders the ScaledObject, in one pass, and leaves the
#      operator in place -- keda.enabled alone, exactly as before the split, so
#      this doubles as the backward-compatibility check.
#   4. An externally managed KEDA (enabled on, install false) renders the custom
#      resources against CRDs it does not own and installs no second operator.
#
# The KEDA operator's Deployments are created but never waited on, so nothing
# here blocks on an image pull. Nothing else waits either: no --wait, no hooks.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

NAMESPACE="${NAMESPACE:-oneuptime-keda-test}"
RELEASE="${RELEASE:-ou}"
CHART_DIR="$HELM_CHART_DIR"

# Flags every helm command in this script shares. Hooks are off so nothing waits
# on a Job. The worker is the tier the original bug report used.
#
# --disable-openapi-validation earns its place twice. It skips a fetch of the
# API server's whole OpenAPI v2 document, which registering six large KEDA CRDs
# makes big enough to time out Helm's client on a loaded runner -- a flake that
# has nothing to do with what is being tested. And it holds case 1 to the
# stronger claim the docs make: the first install fails on the resource MAPPING,
# so turning schema validation off does not rescue it.
HELM_ARGS=(
    --namespace "$NAMESPACE"
    --no-hooks
    --disable-openapi-validation
    --set worker.enabled=true
    --set worker.keda.enabled=true
)

# Runs a helm command that is expected to succeed and scores it. The harness runs
# under `set -e`, so a bare failing helm call would abort the whole suite and hide
# every case after it; guarding each one with `if helm_ok ...` costs the
# assertions that depended on it and nothing else.
helm_ok() {
    # helm_ok <description> <command...>
    local desc="$1"
    shift
    local out
    if out=$("$@" 2>&1); then
        pass "$desc"
        return 0
    fi
    fail "$desc"
    sed 's/^/        /' <<<"$(tail -5 <<<"$out")"
    return 1
}

# The two CRDs this chart renders custom resources for. KEDA ships four more
# (scaledjobs, cloudeventsources, clustercloudeventsources,
# clustertriggerauthentications) that the operator needs but this chart never
# uses; the external-KEDA case below pre-applies all six so it simulates a real
# platform-team install rather than a convenient subset.
KEDA_CRD_TEMPLATES=(
    -s charts/keda/templates/crds/crd-scaledobjects.yaml
    -s charts/keda/templates/crds/crd-triggerauthentications.yaml
    -s charts/keda/templates/crds/crd-scaledjobs.yaml
    -s charts/keda/templates/crds/crd-cloudeventsources.yaml
    -s charts/keda/templates/crds/crd-clustercloudeventsources.yaml
    -s charts/keda/templates/crds/crd-clustertriggerauthentications.yaml
)

# Number of keda.sh CRDs registered on the cluster, however they got there.
keda_crd_count() {
    kubectl get crd -o name 2>/dev/null | grep -c '\.keda\.sh$' || true
}

# Number of KEDA operator Deployments in the namespace. The subchart names them
# keda-operator / keda-operator-metrics-apiserver / keda-admission-webhooks.
keda_operator_deployments() {
    kubectl -n "$NAMESPACE" get deploy -o name 2>/dev/null | grep -c 'deployment.apps/keda' || true
}

scaledobject_names() {
    kubectl -n "$NAMESPACE" get scaledobjects.keda.sh -o name 2>/dev/null || true
}

# Puts the cluster back to "no KEDA at all". The CRDs are cluster-scoped and
# outlive the namespace, and deleting them cascades every custom resource of
# theirs, so this has to run before the first test as well as after the last:
# run.sh shares one KinD cluster between suites, and KEEP_CLUSTER=true hands a
# dirty one to the next run.
reset_cluster() {
    helm uninstall "$RELEASE" -n "$NAMESPACE" >/dev/null 2>&1 || true
    # --timeout matters: kubectl's default is 0s, which it reads as "wait
    # forever", so a CRD stuck on a finalizer would hang the suite with no output
    # rather than fail it. `|| true` cannot rescue a block, only a non-zero exit.
    for crd in $(kubectl get crd -o name 2>/dev/null | grep '\.keda\.sh$'); do
        kubectl delete "$crd" --ignore-not-found --wait=true --timeout=60s >/dev/null 2>&1 || true
    done
}

echo "Chart: $CHART_DIR"

harness_start_cluster

# harness_namespace swallows its own errors, and a KinD API server can still be
# refusing requests for a few seconds after `kind create cluster` returns -- which
# leaves the namespace missing and every install below failing on "namespaces
# ... not found" rather than on anything this suite is about. Retry until it is
# really there.
harness_namespace "$NAMESPACE"
for _ in $(seq 1 30); do
    if kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
        break
    fi
    kubectl create namespace "$NAMESPACE" >/dev/null 2>&1 || true
    sleep 2
done
if ! kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
    fail "namespace ${NAMESPACE} could not be created"
    harness_report
    exit 1
fi

reset_cluster

echo
echo "=== 1. the premise: one pass with KEDA autoscaling cannot bootstrap KEDA ==="
# If this ever starts succeeding, the CRD packaging changed (the subchart moved
# them into crds/, or the chart began shipping them itself) and the bootstrap in
# HelmChart/Docs/Keda.md is obsolete -- delete this case and the two-phase
# instructions together rather than making the assertion looser.
SINGLE_PASS_OUTPUT=$(helm install "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" --set keda.enabled=true 2>&1) && SINGLE_PASS_RC=0 || SINGLE_PASS_RC=1

if [ "$SINGLE_PASS_RC" -ne 0 ]; then
    pass "a single-pass install with keda.enabled fails on a cluster with no KEDA"
else
    fail "a single-pass install with keda.enabled unexpectedly succeeded"
fi
assert_present "it fails on the ScaledObject resource mapping" "$SINGLE_PASS_OUTPUT" 'no matches for kind "ScaledObject" in version "keda.sh/v1alpha1"'
# Helm resolves the whole manifest before it applies any of it, so a failure here
# is total -- this is why re-running the same command never makes progress.
assert_eq "nothing is applied, not even the CRDs" "0" "$(keda_crd_count)"

reset_cluster

echo
echo "=== 2. the bootstrap pass installs the operator and its CRDs ==="
if helm_ok "install with keda.install=true and keda.enabled=false succeeds" \
    helm install "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" \
    --set keda.install=true --set keda.enabled=false; then

    assert_eq "the KEDA CRDs are registered" "6" "$(keda_crd_count)"
    assert_eq "the operator's three Deployments are installed" "3" "$(keda_operator_deployments)"
    # The point of the pass: worker.keda.enabled is true throughout, and it still
    # must not render a ScaledObject, or this pass fails the same way case 1 did.
    assert_eq "no ScaledObject is rendered" "" "$(scaledobject_names)"

    echo
    echo "=== 3. the second pass renders the ScaledObject, and keeps the operator ==="
    # No keda.install here: it is unset, so the dependency condition falls through
    # to keda.enabled and behaves exactly as it did before the split. This is the
    # backward-compatibility case as much as it is phase two.
    if helm_ok "upgrade with keda.enabled=true succeeds once the CRDs exist" \
        helm upgrade "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" --set keda.enabled=true; then

        assert_present "the worker ScaledObject is created" "$(scaledobject_names)" "scaledobject.keda.sh/${RELEASE}-worker-scaledobject"
        assert_eq "the operator is still installed" "3" "$(keda_operator_deployments)"
        assert_present "the TriggerAuthentication is created" \
            "$(kubectl -n "$NAMESPACE" get triggerauthentications.keda.sh -o name 2>/dev/null || true)" \
            "triggerauthentication.keda.sh/${RELEASE}-worker-trigger-auth"
    fi
fi

reset_cluster

echo
echo "=== 4. an externally managed KEDA: CRs render, no second operator ==="
# Stand in for the platform team's KEDA by applying its CRDs out of band. They
# carry no Helm ownership metadata, which is the whole difficulty: a release that
# tried to install its own operator on top would collide with them.
helm template "$RELEASE" "$CHART_DIR" --set keda.install=true "${KEDA_CRD_TEMPLATES[@]}" |
    kubectl apply --server-side -f - >/dev/null
assert_eq "the cluster has KEDA CRDs nobody's release owns" "6" "$(keda_crd_count)"

if helm_ok "install with keda.enabled=true and keda.install=false succeeds in one pass" \
    helm install "$RELEASE" "$CHART_DIR" "${HELM_ARGS[@]}" \
    --set keda.enabled=true --set keda.install=false; then

    assert_present "the worker ScaledObject is created" "$(scaledobject_names)" "scaledobject.keda.sh/${RELEASE}-worker-scaledobject"
    assert_eq "no KEDA operator is installed" "0" "$(keda_operator_deployments)"
fi

reset_cluster

harness_report
