#!/bin/bash
# Verify script for 62-subscriber-notification-template.
#
# The template is a template of its own - its name, event, channel, subject
# and body as written - and the link names that template and the status
# page, read back from the link's own endpoint, not the template's.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Subscriber Notification Template Verification"

validation_failed=0

PAGE_ID=$(get_output status_page_id)
TEMPLATE_ID=$(get_output status_page_subscriber_notification_template_id)
LINK_ID=$(get_output status_page_subscriber_notification_template_status_page_id)

assert_not_empty "$PAGE_ID" "status page id" || validation_failed=1
assert_not_empty "$TEMPLATE_ID" "template id" || validation_failed=1
assert_not_empty "$LINK_ID" "link id" || validation_failed=1

if [ "$TEMPLATE_ID" = "$LINK_ID" ]; then
    echo "    ✗ FAILED: the template and its link are one record ($TEMPLATE_ID)"
    validation_failed=1
fi

TEMPLATE_RESPONSE=$(api_get_resource "/api/status-page-subscriber-notification-template" "$TEMPLATE_ID" \
    '{"_id": true, "templateName": true, "templateDescription": true, "eventType": true, "notificationMethod": true, "emailSubject": true, "templateBody": true}')

validate_field "$TEMPLATE_RESPONSE" "templateName" "TF E2E incident created" || validation_failed=1
validate_field "$TEMPLATE_RESPONSE" "templateDescription" "Sent to email subscribers when an incident is created" || validation_failed=1
validate_field "$TEMPLATE_RESPONSE" "eventType" "Subscriber Incident Created" || validation_failed=1
validate_field "$TEMPLATE_RESPONSE" "notificationMethod" "Email" || validation_failed=1
validate_field "$TEMPLATE_RESPONSE" "emailSubject" "New incident: {{incidentTitle}}" || validation_failed=1
validate_field "$TEMPLATE_RESPONSE" "templateBody" "<p>{{incidentTitle}} is under investigation.</p>" || validation_failed=1

LINK_RESPONSE=$(api_get_resource "/api/status-page-subscriber-notification-template-status-page" "$LINK_ID" \
    '{"_id": true, "statusPageId": true, "statusPageSubscriberNotificationTemplateId": true}')

API_LINK_PAGE_ID=$(echo "$LINK_RESPONSE" | jq -r '(.statusPageId | if type == "object" then .value else . end) // empty')
API_LINK_TEMPLATE_ID=$(echo "$LINK_RESPONSE" | jq -r '(.statusPageSubscriberNotificationTemplateId | if type == "object" then .value else . end) // empty')
assert_equals "$PAGE_ID" "$API_LINK_PAGE_ID" "the link's status page" || validation_failed=1
assert_equals "$TEMPLATE_ID" "$API_LINK_TEMPLATE_ID" "the link's template" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Subscriber Notification Template Verification"
fi

print_passed "Subscriber Notification Template Verification"
