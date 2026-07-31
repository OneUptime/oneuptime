#!/bin/bash
# Verify script for 41-status-page-announcement test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Status Page Announcement Verification"

PAGE_ID=$(get_output status_page_id)
ANNOUNCEMENT_ID=$(get_output status_page_announcement_id)
ANNOUNCEMENT_TITLE=$(get_output announcement_title)

echo "  Verifying announcement via API..."
echo "    Status Page ID: $PAGE_ID"
echo "    Announcement ID: $ANNOUNCEMENT_ID"

assert_not_empty "$ANNOUNCEMENT_ID" "Announcement id" || print_failed "Status Page Announcement Verification"

if ! verify_resource_exists "/api/status-page-announcement" "$ANNOUNCEMENT_ID"; then
    print_failed "Status Page Announcement Verification"
fi

RESPONSE=$(api_get_resource "/api/status-page-announcement" "$ANNOUNCEMENT_ID" \
    '{"_id": true, "title": true, "description": true}')

validation_failed=0

validate_field "$RESPONSE" "title" "$ANNOUNCEMENT_TITLE" || validation_failed=1
validate_field "$RESPONSE" "description" "Announcement created by Terraform E2E tests" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Status Page Announcement Verification"
fi

print_passed "Status Page Announcement Verification"
