#!/bin/bash
# Verify script for 59-people-by-email.
#
# Everyone named by address is the person the API has: the test account
# joined the team at once, the new address was invited (and is still only
# invited), and on call, as owner and in the owner rule each is the right
# user. oneuptime_user found both by address.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "People By Email Verification"

ME=$(get_output me_user)
NEWCOMER=$(get_output newcomer_user)
NEWCOMER_EMAIL=$(get_output newcomer_email)
MEMBERSHIP_ID=$(get_output team_member_id)

assert_not_empty "$ME" "the test account's user id" || print_failed "People By Email Verification"
assert_not_empty "$NEWCOMER" "the newcomer's user id" || print_failed "People By Email Verification"

validation_failed=0

assert_equals "true" "$(get_output me_joined)" "the test account joined at once" || validation_failed=1
assert_equals "false" "$(get_output newcomer_joined)" "the newcomer is invited, not joined" || validation_failed=1
assert_equals "$ME" "$(get_output me_found)" "oneuptime_user found the test account by address" || validation_failed=1
assert_equals "$NEWCOMER" "$(get_output newcomer_found)" "oneuptime_user found the newcomer by address" || validation_failed=1
assert_equals "false" "$(get_output newcomer_found_joined)" "oneuptime_user says the newcomer has not joined" || validation_failed=1
assert_equals "$ME" "$(get_output escalation_rule_user)" "the escalation rule pages the test account" || validation_failed=1
assert_equals "$NEWCOMER" "$(get_output layer_user)" "the newcomer takes turns in the layer" || validation_failed=1
assert_equals "$NEWCOMER_EMAIL" "$(get_output layer_user_email)" "the layer member's address, read for a person named by id" || validation_failed=1
assert_equals "$ME" "$(get_output owner_user)" "the test account owns the monitor" || validation_failed=1
assert_equals "$ME" "$(get_output owner_rule_users)" "the owner rule adds the test account" || validation_failed=1

# The membership, as the API has it: the newcomer's account, by its address,
# with the invitation waiting.
RESPONSE=$(api_get_resource "/api/team-member" "$MEMBERSHIP_ID" '{"_id": true, "userId": true, "hasAcceptedInvitation": true}')
validate_field "$RESPONSE" "userId" "$NEWCOMER" || validation_failed=1
validate_field "$RESPONSE" "hasAcceptedInvitation" "false" || validation_failed=1

LISTED=$(curl -s -X POST "${ONEUPTIME_URL}/api/team-member/get-list" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d "{\"query\": {\"userId\": \"$NEWCOMER\"}, \"select\": {\"_id\": true, \"user\": {\"email\": true}}, \"limit\": 10}")
assert_equals "$NEWCOMER_EMAIL" "$(unwrap_value "$(echo "$LISTED" | jq '.data[0].user.email')")" "the invited account's address" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "People By Email Verification"
fi

print_passed "People By Email Verification"
