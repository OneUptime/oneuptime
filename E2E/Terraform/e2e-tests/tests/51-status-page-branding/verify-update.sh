#!/bin/bash
# Post-update verify script for 51-status-page-branding test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Status Page Branding Update Verification"

PAGE_ID=$(get_output status_page_id)

RESPONSE=$(api_get_resource "/api/status-page" "$PAGE_ID" \
    '{"_id": true, "pageTitle": true, "copyrightText": true, "customCSS": true}')

validation_failed=0

validate_field "$RESPONSE" "pageTitle" "Terraform E2E Branding Updated" || validation_failed=1
validate_field "$RESPONSE" "copyrightText" "Copyright Terraform E2E Updated" || validation_failed=1
validate_field "$RESPONSE" "customCSS" ".status-page { background: #f5f5f5; }" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Status Page Branding Update Verification"
fi

print_passed "Status Page Branding Update Verification"
