#!/bin/bash
# Post-update verify script for 59-people-by-email.
#
# The layer's turn moved to the test account in place, the monitor's owner
# is the newcomer now, and the owner rule adds both.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "People By Email Update Verification"

ME=$(get_output me_user)
NEWCOMER=$(get_output newcomer_user)

validation_failed=0

assert_equals "$ME" "$(get_output layer_user)" "the layer's turn is the test account's" || validation_failed=1
assert_equals "$NEWCOMER" "$(get_output owner_user)" "the newcomer owns the monitor" || validation_failed=1

EXPECTED_RULE_USERS=$(printf '%s\n%s\n' "$ME" "$NEWCOMER" | sort | paste -sd, -)
assert_equals "$EXPECTED_RULE_USERS" "$(get_output owner_rule_users)" "the owner rule adds both" || validation_failed=1

LAYER_USER_ID=$(get_output on_call_duty_schedule_layer_user_id)
RESPONSE=$(api_get_resource "/api/on-call-duty-schedule-layer-user" "$LAYER_USER_ID" '{"_id": true, "userId": true}')
validate_field "$RESPONSE" "userId" "$ME" || validation_failed=1

OWNER_ID=$(get_output monitor_owner_user_id)
RESPONSE=$(api_get_resource "/api/monitor-owner-user" "$OWNER_ID" '{"_id": true, "userId": true}')
validate_field "$RESPONSE" "userId" "$NEWCOMER" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "People By Email Update Verification"
fi

print_passed "People By Email Update Verification"
