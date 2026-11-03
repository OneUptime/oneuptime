#!/bin/bash
# Post-update verify script for 62-subscriber-notification-template.
#
# The update rewrote the template's subject and body in place, and the link
# is the same row, still naming that template.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Subscriber Notification Template Update Verification"

validation_failed=0

TEMPLATE_ID=$(get_output status_page_subscriber_notification_template_id)
LINK_ID=$(get_output status_page_subscriber_notification_template_status_page_id)

TEMPLATE_RESPONSE=$(api_get_resource "/api/status-page-subscriber-notification-template" "$TEMPLATE_ID" \
    '{"_id": true, "emailSubject": true, "templateBody": true}')

validate_field "$TEMPLATE_RESPONSE" "emailSubject" "Incident: {{incidentTitle}}" || validation_failed=1
validate_field "$TEMPLATE_RESPONSE" "templateBody" "<p>We are looking into {{incidentTitle}}.</p>" || validation_failed=1

LINK_RESPONSE=$(api_get_resource "/api/status-page-subscriber-notification-template-status-page" "$LINK_ID" \
    '{"_id": true, "statusPageSubscriberNotificationTemplateId": true}')

API_LINK_TEMPLATE_ID=$(echo "$LINK_RESPONSE" | jq -r '(.statusPageSubscriberNotificationTemplateId | if type == "object" then .value else . end) // empty')
assert_equals "$TEMPLATE_ID" "$API_LINK_TEMPLATE_ID" "the link's template after the update" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Subscriber Notification Template Update Verification"
fi

print_passed "Subscriber Notification Template Update Verification"
