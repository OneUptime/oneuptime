#!/usr/bin/env bash
#
# `helm lint` over both published charts. Needs no cluster.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

harness_install_helm

for chart in "$HELM_CHART_DIR" "$KUBERNETES_AGENT_CHART_DIR"; do
    name="$(basename "$chart")"
    if helm lint "$chart"; then
        pass "helm lint ${name}"
    else
        fail "helm lint ${name}"
    fi
done

harness_report
