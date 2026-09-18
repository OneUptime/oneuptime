#!/bin/bash
# Verify script for 51-status-page-branding test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Status Page Branding Verification"

PAGE_ID=$(get_output status_page_id)
PAGE_TITLE=$(get_output status_page_page_title)

echo "  Verifying status page branding via API..."
echo "    Status Page ID: $PAGE_ID"

assert_not_empty "$PAGE_ID" "Status page id" || print_failed "Status Page Branding Verification"

if ! verify_resource_exists "/api/status-page" "$PAGE_ID"; then
    print_failed "Status Page Branding Verification"
fi

RESPONSE=$(api_get_resource "/api/status-page" "$PAGE_ID" \
    '{"_id": true, "pageTitle": true, "copyrightText": true, "customCSS": true, "hidePoweredByOneUptimeBranding": true}')

validation_failed=0

validate_field "$RESPONSE" "pageTitle" "$PAGE_TITLE" || validation_failed=1
validate_field "$RESPONSE" "copyrightText" "Copyright Terraform E2E" || validation_failed=1
validate_field "$RESPONSE" "customCSS" ".status-page { background: #ffffff; }" || validation_failed=1
validate_field "$RESPONSE" "hidePoweredByOneUptimeBranding" "true" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Status Page Branding Verification"
fi

print_passed "Status Page Branding Verification"
