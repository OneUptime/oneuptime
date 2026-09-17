#!/bin/bash
# Verify script for 42-status-page-resources test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Status Page Group and Resource Verification"

PAGE_ID=$(get_output status_page_id)
GROUP_ID=$(get_output status_page_group_id)
RESOURCE_ID=$(get_output status_page_resource_id)
MONITOR_ID=$(get_output monitor_id)
GROUP_NAME=$(get_output group_name)
DISPLAY_NAME=$(get_output resource_display_name)

echo "  Verifying status page group and resource via API..."
echo "    Group ID: $GROUP_ID"
echo "    Resource ID: $RESOURCE_ID"

assert_not_empty "$GROUP_ID" "Group id" || print_failed "Status Page Group and Resource Verification"
assert_not_empty "$RESOURCE_ID" "Resource id" || print_failed "Status Page Group and Resource Verification"

if ! verify_resource_exists "/api/status-page-group" "$GROUP_ID"; then
    print_failed "Status Page Group and Resource Verification"
fi

if ! verify_resource_exists "/api/status-page-resource" "$RESOURCE_ID"; then
    print_failed "Status Page Group and Resource Verification"
fi

GROUP_RESPONSE=$(api_get_resource "/api/status-page-group" "$GROUP_ID" \
    '{"_id": true, "name": true, "statusPageId": true}')
RESOURCE_RESPONSE=$(api_get_resource "/api/status-page-resource" "$RESOURCE_ID" \
    '{"_id": true, "displayName": true, "statusPageId": true, "monitorId": true, "statusPageGroupId": true}')

validation_failed=0

validate_field "$GROUP_RESPONSE" "name" "$GROUP_NAME" || validation_failed=1
validate_field "$RESOURCE_RESPONSE" "displayName" "$DISPLAY_NAME" || validation_failed=1

# The resource must be wired to the monitor and group from this fixture
API_MONITOR_ID=$(echo "$RESOURCE_RESPONSE" | jq -r '(.monitorId | if type == "object" then .value else . end) // empty')
API_GROUP_ID=$(echo "$RESOURCE_RESPONSE" | jq -r '(.statusPageGroupId | if type == "object" then .value else . end) // empty')
assert_equals "$MONITOR_ID" "$API_MONITOR_ID" "monitorId" || validation_failed=1
assert_equals "$GROUP_ID" "$API_GROUP_ID" "statusPageGroupId" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Status Page Group and Resource Verification"
fi

print_passed "Status Page Group and Resource Verification"
