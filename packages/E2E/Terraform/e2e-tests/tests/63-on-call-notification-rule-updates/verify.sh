#!/bin/bash
# Verify script for 63-on-call-notification-rule-updates (#7971).
#
# A rule whose notification_rule leaves updatesToPost out was stored with
# the key updates a new on-call rule starts on; the one that said null was
# stored with null, every update. The runner's drift gate has already held
# the plan to no change.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "On-Call Notification Rule Updates Verification"

validation_failed=0

KEY_RULE_ID=$(get_output workspace_notification_rule_id)
EVERY_RULE_ID=$(get_output every_update_rule)

assert_not_empty "$KEY_RULE_ID" "key updates rule id" || validation_failed=1
assert_not_empty "$EVERY_RULE_ID" "every update rule id" || validation_failed=1

KEY_RESPONSE=$(api_get_resource "/api/workspace-notification-rule" "$KEY_RULE_ID" \
    '{"_id": true, "eventType": true, "notificationRule": true}')

validate_field "$KEY_RESPONSE" "eventType" "On-Call Duty Policy" || validation_failed=1

KEY_UPDATES=$(echo "$KEY_RESPONSE" | jq -c '.notificationRule.updatesToPost')
assert_equals '["OnCallNow","NobodyOnCall"]' "$KEY_UPDATES" "updatesToPost left out" || validation_failed=1

KEY_CHANNEL=$(echo "$KEY_RESPONSE" | jq -r '.notificationRule.existingChannelNames')
assert_equals "terraform-e2e-oncall" "$KEY_CHANNEL" "existingChannelNames" || validation_failed=1

EVERY_RESPONSE=$(api_get_resource "/api/workspace-notification-rule" "$EVERY_RULE_ID" \
    '{"_id": true, "notificationRule": true}')

EVERY_HAS_KEY=$(echo "$EVERY_RESPONSE" | jq -r '.notificationRule | has("updatesToPost")')
EVERY_UPDATES=$(echo "$EVERY_RESPONSE" | jq -c '.notificationRule.updatesToPost')
assert_equals "true" "$EVERY_HAS_KEY" "updatesToPost null is stored" || validation_failed=1
assert_equals "null" "$EVERY_UPDATES" "updatesToPost null" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "On-Call Notification Rule Updates Verification"
fi

print_passed "On-Call Notification Rule Updates Verification"
