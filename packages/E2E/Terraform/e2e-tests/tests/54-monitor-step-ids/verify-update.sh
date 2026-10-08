#!/bin/bash
# Post-update verify script for 54-monitor-step-ids.
#
# update.tf resent the steps - with a new destination, changed descriptions
# and titles, and a criteria added between the two - still without any ids.
# Every id verify.sh recorded must have survived, and the added criteria must
# have one of its own.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Monitor Step Ids Update Verification"

MONITOR_ID=$(get_output monitor_id)
RECORDED="${TMPDIR:-/tmp}/oneuptime-e2e-step-ids-${MONITOR_ID}"

if [ ! -f "$RECORDED" ]; then
    echo "    ✗ verify.sh recorded no ids for monitor $MONITOR_ID"
    print_failed "Monitor Step Ids Update Verification"
fi

# shellcheck disable=SC1090
source "$RECORDED"

RESPONSE=$(api_get_resource "/api/monitor" "$MONITOR_ID" '{"_id": true, "monitorSteps": true}')
STEPS=$(echo "$RESPONSE" | jq -c '.monitorSteps.value // empty')

STEP='.monitorStepsInstanceArray[0].value'
CRITERIA="${STEP}.monitorCriteria.value.monitorCriteriaInstanceArray[].value"

DESTINATION=$(echo "$STEPS" | jq -r "${STEP}.monitorDestination.value // empty")
failed=0

# The update landed: otherwise "every id survived" proves nothing.
if [ "${DESTINATION%/}" != "https://example.org" ]; then
    echo "    ✗ The update did not reach the steps: destination is '$DESTINATION'"
    print_failed "Monitor Step Ids Update Verification"
fi

check_kept() { # what before after
    if [ "$2" = "$3" ]; then
        echo "    ✓ $1 kept its id: $3"
    else
        echo "    ✗ $1 had id $2 and now has '$3'"
        failed=1
    fi
}

check_kept "the step" "$STEP_ID" "$(echo "$STEPS" | jq -r "${STEP}.id // empty")"
check_kept "the Offline criteria" "$OFFLINE_ID" "$(echo "$STEPS" | jq -r "${CRITERIA} | select(.name == \"Offline\") | .id // empty")"
check_kept "the Online criteria" "$ONLINE_ID" "$(echo "$STEPS" | jq -r "${CRITERIA} | select(.name == \"Online\") | .id // empty")"
check_kept "the incident template" "$INCIDENT_TEMPLATE_ID" "$(echo "$STEPS" | jq -r "${CRITERIA} | select(.name == \"Offline\") | .incidents[0].id // empty")"
check_kept "the alert template" "$ALERT_TEMPLATE_ID" "$(echo "$STEPS" | jq -r "${CRITERIA} | select(.name == \"Offline\") | .alerts[0].id // empty")"

DEGRADED_ID=$(echo "$STEPS" | jq -r "${CRITERIA} | select(.name == \"Degraded\") | .id // empty")
UUID='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'

if [[ "$DEGRADED_ID" =~ $UUID ]] && [ "$DEGRADED_ID" != "$OFFLINE_ID" ] && [ "$DEGRADED_ID" != "$ONLINE_ID" ]; then
    echo "    ✓ the added Degraded criteria has an id of its own: $DEGRADED_ID"
else
    echo "    ✗ the added Degraded criteria has id '$DEGRADED_ID'"
    failed=1
fi

rm -f "$RECORDED"

if [ $failed -eq 1 ]; then
    print_failed "Monitor Step Ids Update Verification"
fi

print_passed "Monitor Step Ids Update Verification"
