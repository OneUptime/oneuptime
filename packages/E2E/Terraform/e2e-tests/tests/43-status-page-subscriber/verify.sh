#!/bin/bash
# Verify script for 43-status-page-subscriber test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Status Page Subscriber Verification"

PAGE_ID=$(get_output status_page_id)
SUBSCRIBER_ID=$(get_output status_page_subscriber_id)

echo "  Verifying subscriber via API..."
echo "    Status Page ID: $PAGE_ID"
echo "    Subscriber ID: $SUBSCRIBER_ID"

assert_not_empty "$SUBSCRIBER_ID" "Subscriber id" || print_failed "Status Page Subscriber Verification"

if ! verify_resource_exists "/api/status-page-subscriber" "$SUBSCRIBER_ID"; then
    print_failed "Status Page Subscriber Verification"
fi

RESPONSE=$(api_get_resource "/api/status-page-subscriber" "$SUBSCRIBER_ID" \
    '{"_id": true, "subscriberEmail": true, "internalNote": true, "statusPageId": true}')

validation_failed=0

# subscriberEmail comes back as an Email wrapper object; validate_field unwraps it
validate_field "$RESPONSE" "subscriberEmail" "terraform-e2e-subscriber@test.oneuptime.com" || validation_failed=1
validate_field "$RESPONSE" "internalNote" "Subscriber created by Terraform E2E tests" || validation_failed=1

API_PAGE_ID=$(echo "$RESPONSE" | jq -r '(.statusPageId | if type == "object" then .value else . end) // empty')
assert_equals "$PAGE_ID" "$API_PAGE_ID" "statusPageId" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Status Page Subscriber Verification"
fi

print_passed "Status Page Subscriber Verification"
