#!/bin/bash
# Verify script for 46-api-key test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "API Key Verification"

KEY_ID=$(get_output api_key_id)
PERMISSION_ID=$(get_output api_key_permission_id)
KEY_NAME=$(get_output api_key_name)

echo "  Verifying API key via API..."
echo "    API Key ID: $KEY_ID"
echo "    Permission ID: $PERMISSION_ID"

assert_not_empty "$KEY_ID" "API key id" || print_failed "API Key Verification"
assert_not_empty "$PERMISSION_ID" "API key permission id" || print_failed "API Key Verification"

if ! verify_resource_exists "/api/api-key" "$KEY_ID"; then
    print_failed "API Key Verification"
fi

if ! verify_resource_exists "/api/api-key-permission" "$PERMISSION_ID"; then
    print_failed "API Key Verification"
fi

KEY_RESPONSE=$(api_get_resource "/api/api-key" "$KEY_ID" \
    '{"_id": true, "name": true, "description": true}')
PERMISSION_RESPONSE=$(api_get_resource "/api/api-key-permission" "$PERMISSION_ID" \
    '{"_id": true, "permission": true, "apiKeyId": true}')

validation_failed=0

validate_field "$KEY_RESPONSE" "name" "$KEY_NAME" || validation_failed=1
validate_field "$KEY_RESPONSE" "description" "API key created by Terraform E2E tests" || validation_failed=1
validate_field "$PERMISSION_RESPONSE" "permission" "ReadProjectMonitor" || validation_failed=1

API_KEY_REF=$(echo "$PERMISSION_RESPONSE" | jq -r '.apiKeyId // empty')
assert_equals "$KEY_ID" "$API_KEY_REF" "apiKeyId" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "API Key Verification"
fi

print_passed "API Key Verification"
