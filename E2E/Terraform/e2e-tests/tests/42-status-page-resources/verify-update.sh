#!/bin/bash
# Post-update verify script for 42-status-page-resources test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Status Page Group and Resource Update Verification"

GROUP_ID=$(get_output status_page_group_id)
RESOURCE_ID=$(get_output status_page_resource_id)

GROUP_RESPONSE=$(api_get_resource "/api/status-page-group" "$GROUP_ID" \
    '{"_id": true, "name": true}')
RESOURCE_RESPONSE=$(api_get_resource "/api/status-page-resource" "$RESOURCE_ID" \
    '{"_id": true, "displayName": true, "displayDescription": true}')

validation_failed=0

validate_field "$GROUP_RESPONSE" "name" "terraform-e2e-sp-group-updated" || validation_failed=1
validate_field "$RESOURCE_RESPONSE" "displayName" "terraform-e2e-sp-resource-updated" || validation_failed=1
validate_field "$RESOURCE_RESPONSE" "displayDescription" "Resource updated by Terraform E2E tests" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Status Page Group and Resource Update Verification"
fi

print_passed "Status Page Group and Resource Update Verification"
