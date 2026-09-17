#!/bin/bash
# Post-update verify script for 43-status-page-subscriber test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Status Page Subscriber Update Verification"

SUBSCRIBER_ID=$(get_output status_page_subscriber_id)

RESPONSE=$(api_get_resource "/api/status-page-subscriber" "$SUBSCRIBER_ID" \
    '{"_id": true, "internalNote": true, "isSubscribedToAllResources": true}')

validation_failed=0

validate_field "$RESPONSE" "internalNote" "Subscriber updated by Terraform E2E tests" || validation_failed=1
validate_field "$RESPONSE" "isSubscribedToAllResources" "true" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Status Page Subscriber Update Verification"
fi

print_passed "Status Page Subscriber Update Verification"
