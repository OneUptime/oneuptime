#!/usr/bin/env bash
#
# The helm-unittest suites in HelmChart/Public/oneuptime/tests. They render the
# templates and assert on the result, so they need no cluster -- which also
# means `lookup` always comes back empty for them; the behaviour that depends on
# a real API server is covered by the secrets-lifecycle suite instead.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

harness_install_helm
harness_install_unittest_plugin

if helm unittest "$HELM_CHART_DIR"; then
    pass "helm unittest"
else
    fail "helm unittest reported failing assertions (see the output above)"
fi

harness_report
