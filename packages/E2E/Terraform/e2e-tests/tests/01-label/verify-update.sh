#!/bin/bash
# Post-update verify script for 01-label test
# Validates that the updated field values landed in the API

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Label Resource Update Verification"

LABEL_ID=$(get_output label_id)

echo "  Verifying updated label via API..."
echo "    Label ID: $LABEL_ID"

if ! verify_resource_exists "/api/label" "$LABEL_ID"; then
    print_failed "Label Resource Update Verification"
fi

RESPONSE=$(api_get_resource "/api/label" "$LABEL_ID" '{"_id": true, "name": true, "description": true, "color": true}')

validation_failed=0

validate_field "$RESPONSE" "name" "terraform-e2e-label-updated" || validation_failed=1
validate_field "$RESPONSE" "description" "Label updated by Terraform E2E tests" || validation_failed=1
validate_field "$RESPONSE" "color" "#33C1FF" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Label Resource Update Verification"
fi

print_passed "Label Resource Update Verification"
