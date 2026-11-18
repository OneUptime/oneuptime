#!/bin/bash
# Post-update verify script for 63-on-call-notification-rule-updates (#7971).
#
# update.tf changed the first rule's channel and sent its notification_rule
# without updatesToPost, as a Terraform configuration that never set it
# does. The rule kept the key updates it started on: it did not turn to
# every update at its first change. The null rule still posts every update.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "On-Call Notification Rule Updates Verification (after update)"

validation_failed=0

KEY_RULE_ID=$(get_output workspace_notification_rule_id)
EVERY_RULE_ID=$(get_output every_update_rule)

KEY_RESPONSE=$(api_get_resource "/api/workspace-notification-rule" "$KEY_RULE_ID" \
    '{"_id": true, "notificationRule": true}')

KEY_CHANNEL=$(echo "$KEY_RESPONSE" | jq -r '.notificationRule.existingChannelNames')
assert_equals "terraform-e2e-on-call" "$KEY_CHANNEL" "existingChannelNames after the update" || validation_failed=1

KEY_UPDATES=$(echo "$KEY_RESPONSE" | jq -c '.notificationRule.updatesToPost')
assert_equals '["OnCallNow","NobodyOnCall"]' "$KEY_UPDATES" "updatesToPost kept by the update" || validation_failed=1

EVERY_RESPONSE=$(api_get_resource "/api/workspace-notification-rule" "$EVERY_RULE_ID" \
    '{"_id": true, "notificationRule": true}')

EVERY_UPDATES=$(echo "$EVERY_RESPONSE" | jq -c '.notificationRule.updatesToPost')
assert_equals "null" "$EVERY_UPDATES" "updatesToPost null after the update" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "On-Call Notification Rule Updates Verification (after update)"
fi

print_passed "On-Call Notification Rule Updates Verification (after update)"
