#!/bin/bash
# Post-update verify script for 41-status-page-announcement test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Status Page Announcement Update Verification"

ANNOUNCEMENT_ID=$(get_output status_page_announcement_id)

RESPONSE=$(api_get_resource "/api/status-page-announcement" "$ANNOUNCEMENT_ID" \
    '{"_id": true, "title": true, "description": true}')

validation_failed=0

validate_field "$RESPONSE" "title" "terraform-e2e-announcement-updated" || validation_failed=1
validate_field "$RESPONSE" "description" "Announcement updated by Terraform E2E tests" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Status Page Announcement Update Verification"
fi

print_passed "Status Page Announcement Update Verification"
