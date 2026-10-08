#!/bin/bash
# Post-update verify script for 57-custom-code-monitor-options.
#
# update.tf changed the status filter's field path, removed the latency
# filter's and gave the Healthy filter one. Each change must have reached the
# server: a removed path that stayed stored would keep comparing a field the
# configuration no longer names.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Custom Code Monitor Options Update Verification"

MONITOR_ID=$(get_output monitor_id)
FIRST_FIELD_PATH=$(get_output first_field_path)

assert_not_empty "$MONITOR_ID" "monitor_id" || print_failed "Custom Code Monitor Options Update Verification"

RESPONSE=$(api_get_resource "/api/monitor" "$MONITOR_ID" '{"_id": true, "monitorSteps": true}')
STEPS=$(echo "$RESPONSE" | jq -c '.monitorSteps.value // empty')

if [ -z "$STEPS" ]; then
    echo "    ✗ The monitor has no monitorSteps. Response: $RESPONSE"
    print_failed "Custom Code Monitor Options Update Verification"
fi

STEP='.monitorStepsInstanceArray[0].value'
CRITERIA="${STEP}.monitorCriteria.value.monitorCriteriaInstanceArray[].value"

# The update landed: otherwise "the path changed" proves nothing.
CUSTOM_CODE=$(echo "$STEPS" | jq -r "${STEP}.customCode // empty")
if [[ "$CUSTOM_CODE" != *"health: { status: 'UP' }"* ]]; then
    echo "    ✗ The update did not reach the steps: customCode is '$CUSTOM_CODE'"
    print_failed "Custom Code Monitor Options Update Verification"
fi

failed=0

stored_path() { # criteria index
    echo "$STEPS" | jq -r "[${CRITERIA} | select(.name == \"$1\")][0].filters[$2].customCodeMonitorOptions.resultValuePath // empty"
}

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
        echo "    ✗ $1 still has customCodeMonitorOptions (has=$present)"
        failed=1
    fi
}

check_path "the changed status filter" "Unhealthy" 0 "health.status"
check_no_options "the latency filter whose path was removed" "Unhealthy" 1
check_no_options "the Unhealthy error filter" "Unhealthy" 2
check_path "the Healthy filter that gained a path" "Healthy" 0 "health.status"

assert_equals "health.status" "$FIRST_FIELD_PATH" "first_field_path output" || failed=1

if [ $failed -eq 1 ]; then
    print_failed "Custom Code Monitor Options Update Verification"
fi

print_passed "Custom Code Monitor Options Update Verification"
