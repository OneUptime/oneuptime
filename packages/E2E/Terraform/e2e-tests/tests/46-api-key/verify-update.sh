#!/bin/bash
# Post-update verify script for 46-api-key test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "API Key Update Verification"

KEY_ID=$(get_output api_key_id)

RESPONSE=$(api_get_resource "/api/api-key" "$KEY_ID" \
    '{"_id": true, "name": true, "description": true}')

validation_failed=0

validate_field "$RESPONSE" "name" "terraform-e2e-api-key-updated" || validation_failed=1
validate_field "$RESPONSE" "description" "API key updated by Terraform E2E tests" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "API Key Update Verification"
fi

print_passed "API Key Update Verification"
