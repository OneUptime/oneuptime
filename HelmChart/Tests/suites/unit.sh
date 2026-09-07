#!/usr/bin/env bash
#
# The helm-unittest suites in each published chart's own tests/ directory. They
# render the templates and assert on the result, so they need no cluster --
# which also means `lookup` always comes back empty for them; the behaviour that
# depends on a real API server is covered by the secrets-lifecycle suite
# instead.
#
# Both published charts are covered, the same way `lint` covers both: the
# kubernetes-agent chart writes the collector configuration that decides what
# resource attributes OneUptime's ingest sees, so a mistake in it shows up as
# wrong data rather than as a broken deploy -- which is exactly the kind of
# thing a cluster-free render test catches and a human review does not.

# shellcheck source=../lib/harness.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")/../lib" && pwd)/harness.sh"

harness_install_helm
harness_install_unittest_plugin

for chart in "$HELM_CHART_DIR" "$KUBERNETES_AGENT_CHART_DIR"; do
    chart_name="$(basename "$chart")"

    # A chart with no tests/ directory is not a failure, just nothing to run.
    if [ ! -d "${chart}/tests" ]; then
        continue
    fi

    if helm unittest "$chart"; then
        pass "helm unittest (${chart_name})"
    else
        fail "helm unittest reported failing assertions for ${chart_name} (see the output above)"
    fi
done

harness_report
