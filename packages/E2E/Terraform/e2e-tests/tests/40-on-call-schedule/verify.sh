#!/bin/bash
# Verify script for 40-on-call-schedule test
# Validates the on-call schedule and its layer via the API

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "On-Call Schedule Verification"

SCHEDULE_ID=$(get_output on_call_duty_policy_schedule_id)
LAYER_ID=$(get_output on_call_duty_schedule_layer_id)
SCHEDULE_NAME=$(get_output schedule_name)
LAYER_NAME=$(get_output layer_name)

echo "  Verifying on-call schedule via API..."
echo "    Schedule ID: $SCHEDULE_ID"
echo "    Layer ID: $LAYER_ID"

assert_not_empty "$SCHEDULE_ID" "Schedule id" || print_failed "On-Call Schedule Verification"
assert_not_empty "$LAYER_ID" "Layer id" || print_failed "On-Call Schedule Verification"

if ! verify_resource_exists "/api/on-call-duty-policy-schedule" "$SCHEDULE_ID"; then
    print_failed "On-Call Schedule Verification"
fi

if ! verify_resource_exists "/api/on-call-duty-schedule-layer" "$LAYER_ID"; then
    print_failed "On-Call Schedule Verification"
fi

SCHEDULE_RESPONSE=$(api_get_resource "/api/on-call-duty-policy-schedule" "$SCHEDULE_ID" \
    '{"_id": true, "name": true, "description": true}')
LAYER_RESPONSE=$(api_get_resource "/api/on-call-duty-schedule-layer" "$LAYER_ID" \
    '{"_id": true, "name": true, "description": true, "onCallDutyPolicyScheduleId": true}')

validation_failed=0

validate_field "$SCHEDULE_RESPONSE" "name" "$SCHEDULE_NAME" || validation_failed=1
validate_field "$LAYER_RESPONSE" "name" "$LAYER_NAME" || validation_failed=1

# The layer must belong to the schedule created in this fixture
API_SCHEDULE_ID=$(echo "$LAYER_RESPONSE" | jq -r '(.onCallDutyPolicyScheduleId | if type == "object" then .value else . end) // empty')
assert_equals "$SCHEDULE_ID" "$API_SCHEDULE_ID" "onCallDutyPolicyScheduleId" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "On-Call Schedule Verification"
fi

print_passed "On-Call Schedule Verification"
