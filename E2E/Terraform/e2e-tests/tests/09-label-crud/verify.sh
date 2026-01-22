#!/bin/bash
# Verify script for 09-label-crud test
# Validates that the label CRUD operations work correctly via API

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Label CRUD Verification"

# Get terraform outputs
RESOURCE_ID=$(get_output label_id)
EXPECTED_NAME=$(get_output label_name)
EXPECTED_DESCRIPTION=$(get_output label_description)
EXPECTED_COLOR=$(get_output label_color)

echo "  Verifying label CRUD resource via API..."
echo "    Resource ID: $RESOURCE_ID"

# Verify resource exists
if ! verify_resource_exists "/api/label" "$RESOURCE_ID"; then
    print_failed "Label CRUD Verification"
fi

# Get full resource for validation
RESPONSE=$(api_get_resource "/api/label" "$RESOURCE_ID" '{"_id": true, "name": true, "description": true, "color": true}')

# Validate all fields
validation_failed=0

validate_field "$RESPONSE" "name" "$EXPECTED_NAME" || validation_failed=1
validate_field "$RESPONSE" "description" "$EXPECTED_DESCRIPTION" || validation_failed=1
validate_field "$RESPONSE" "color" "$EXPECTED_COLOR" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Label CRUD Verification"
fi

print_passed "Label CRUD Verification"
