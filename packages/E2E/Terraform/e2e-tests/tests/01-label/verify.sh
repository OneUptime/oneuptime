#!/bin/bash
# Verify script for 01-label test
# Validates that the label resource was created correctly via API

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Label Resource Verification"

# Get terraform outputs
LABEL_ID=$(get_output label_id)
LABEL_NAME=$(get_output label_name)
LABEL_DESCRIPTION=$(get_output label_description)
LABEL_COLOR=$(get_output label_color)

echo "  Verifying label resource via API..."
echo "    Label ID: $LABEL_ID"

# Verify resource exists
if ! verify_resource_exists "/api/label" "$LABEL_ID"; then
    print_failed "Label Resource Verification"
fi

# Get full resource for validation
RESPONSE=$(api_get_resource "/api/label" "$LABEL_ID" '{"_id": true, "name": true, "description": true, "color": true}')

# Validate all fields
validation_failed=0

validate_field "$RESPONSE" "name" "$LABEL_NAME" || validation_failed=1
validate_field "$RESPONSE" "description" "$LABEL_DESCRIPTION" || validation_failed=1
validate_field "$RESPONSE" "color" "$LABEL_COLOR" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Label Resource Verification"
fi

print_passed "Label Resource Verification"
