#!/bin/bash
# Verify script for 54-monitor-step-ids.
#
# The provider sent the monitor's steps without a single id. Checks the
# server gave the step, both criteria and both templates one, and gave the
# steps the project's operational status as their default - then records the
# ids for verify-update.sh, which checks an update kept every one of them.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Monitor Step Ids Verification"

MONITOR_ID=$(get_output monitor_id)
OPERATIONAL_STATUS=$(get_output operational_status)

assert_not_empty "$MONITOR_ID" "monitor_id" || print_failed "Monitor Step Ids Verification"
assert_not_empty "$OPERATIONAL_STATUS" "operational_status" || print_failed "Monitor Step Ids Verification"

RESPONSE=$(api_get_resource "/api/monitor" "$MONITOR_ID" '{"_id": true, "monitorSteps": true}')
STEPS=$(echo "$RESPONSE" | jq -c '.monitorSteps.value // empty')

if [ -z "$STEPS" ]; then
    echo "    ✗ The monitor has no monitorSteps. Response: $RESPONSE"
    print_failed "Monitor Step Ids Verification"
fi

STEP='.monitorStepsInstanceArray[0].value'
CRITERIA="${STEP}.monitorCriteria.value.monitorCriteriaInstanceArray[].value"

STEP_ID=$(echo "$STEPS" | jq -r "${STEP}.id // empty")
OFFLINE_ID=$(echo "$STEPS" | jq -r "${CRITERIA} | select(.name == \"Offline\") | .id // empty")
ONLINE_ID=$(echo "$STEPS" | jq -r "${CRITERIA} | select(.name == \"Online\") | .id // empty")
INCIDENT_TEMPLATE_ID=$(echo "$STEPS" | jq -r "${CRITERIA} | select(.name == \"Offline\") | .incidents[0].id // empty")
ALERT_TEMPLATE_ID=$(echo "$STEPS" | jq -r "${CRITERIA} | select(.name == \"Offline\") | .alerts[0].id // empty")
DEFAULT_STATUS=$(echo "$STEPS" | jq -r '.defaultMonitorStatusId // empty')

UUID='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
failed=0

check_id() { # what value
    if [[ "$2" =~ $UUID ]]; then
        echo "    ✓ $1 has an id: $2"
    else
        echo "    ✗ $1 has no id (got '$2')"
        failed=1
    fi
}

check_id "the step" "$STEP_ID"
check_id "the Offline criteria" "$OFFLINE_ID"
check_id "the Online criteria" "$ONLINE_ID"
check_id "the incident template" "$INCIDENT_TEMPLATE_ID"
check_id "the alert template" "$ALERT_TEMPLATE_ID"

if [ "$OFFLINE_ID" = "$ONLINE_ID" ]; then
    echo "    ✗ Both criteria have the same id: $OFFLINE_ID"
    failed=1
fi

if [ "$DEFAULT_STATUS" = "$OPERATIONAL_STATUS" ]; then
    echo "    ✓ The steps default to the operational status"
else
    echo "    ✗ The steps' default status is '$DEFAULT_STATUS', not the operational status '$OPERATIONAL_STATUS'"
    failed=1
fi

if [ $failed -eq 1 ]; then
    print_failed "Monitor Step Ids Verification"
fi

# For verify-update.sh: the ids an update must keep.
cat > "${TMPDIR:-/tmp}/oneuptime-e2e-step-ids-${MONITOR_ID}" <<IDS
STEP_ID=$STEP_ID
OFFLINE_ID=$OFFLINE_ID
ONLINE_ID=$ONLINE_ID
INCIDENT_TEMPLATE_ID=$INCIDENT_TEMPLATE_ID
ALERT_TEMPLATE_ID=$ALERT_TEMPLATE_ID
IDS

print_passed "Monitor Step Ids Verification"
