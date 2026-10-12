#!/bin/bash
# Verify script for 57-custom-code-monitor-options.
#
# The provider sent each Result Value filter's custom_code_monitor_options
# under customCodeMonitorOptions. Checks the server stored every field path on
# the filter it belongs to, and nothing on the filters that have none - the
# options of one filter must never land on another.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Custom Code Monitor Options Verification"

MONITOR_ID=$(get_output monitor_id)
FIRST_FIELD_PATH=$(get_output first_field_path)

assert_not_empty "$MONITOR_ID" "monitor_id" || print_failed "Custom Code Monitor Options Verification"

RESPONSE=$(api_get_resource "/api/monitor" "$MONITOR_ID" '{"_id": true, "monitorType": true, "monitorSteps": true}')
STEPS=$(echo "$RESPONSE" | jq -c '.monitorSteps.value // empty')

if [ -z "$STEPS" ]; then
    echo "    ✗ The monitor has no monitorSteps. Response: $RESPONSE"
    print_failed "Custom Code Monitor Options Verification"
fi

STEP='.monitorStepsInstanceArray[0].value'
CRITERIA="${STEP}.monitorCriteria.value.monitorCriteriaInstanceArray[].value"

failed=0

# The field path a criteria's filter stored ('' when it has none).
stored_path() { # criteria index
    echo "$STEPS" | jq -r "[${CRITERIA} | select(.name == \"$1\")][0].filters[$2].customCodeMonitorOptions.resultValuePath // empty"
}

# Whether a criteria's filter stored any customCodeMonitorOptions at all
# ("missing" when there is no such filter).
has_options() { # criteria index
    echo "$STEPS" | jq -r "[${CRITERIA} | select(.name == \"$1\")][0].filters[$2] | if type == \"object\" then has(\"customCodeMonitorOptions\") else \"missing\" end"
}

check_path() { # what criteria index expected
    local actual
    actual=$(stored_path "$2" "$3")
    if [ "$actual" = "$4" ]; then
        echo "    ✓ $1 compares the field '$actual'"
    else
        echo "    ✗ $1 stored the field path '$actual', not '$4'"
        failed=1
    fi
}

check_no_options() { # what criteria index
    local present
    present=$(has_options "$2" "$3")
    if [ "$present" = "false" ]; then
        echo "    ✓ $1 has no customCodeMonitorOptions"
    else
        echo "    ✗ $1 has customCodeMonitorOptions it was never given (has=$present)"
        failed=1
    fi
}

assert_equals "Custom JavaScript Code" "$(echo "$RESPONSE" | jq -r '.monitorType // empty')" "monitorType" || failed=1

check_path "the Unhealthy status filter" "Unhealthy" 0 "status"
check_path "the Unhealthy latency filter" "Unhealthy" 1 "checks[0].latency"
check_no_options "the Unhealthy error filter" "Unhealthy" 2
check_no_options "the Healthy filter" "Healthy" 0

# The filters around the paths are stored as written too.
assert_equals "Result Value" "$(echo "$STEPS" | jq -r "[${CRITERIA} | select(.name == \"Unhealthy\")][0].filters[1].checkOn // empty")" "the latency filter's checkOn" || failed=1
assert_equals "Greater Than" "$(echo "$STEPS" | jq -r "[${CRITERIA} | select(.name == \"Unhealthy\")][0].filters[1].filterType // empty")" "the latency filter's filterType" || failed=1

# The nested attribute reads back through Terraform as well.
assert_equals "status" "$FIRST_FIELD_PATH" "first_field_path output" || failed=1

if [ $failed -eq 1 ]; then
    print_failed "Custom Code Monitor Options Verification"
fi

print_passed "Custom Code Monitor Options Verification"
