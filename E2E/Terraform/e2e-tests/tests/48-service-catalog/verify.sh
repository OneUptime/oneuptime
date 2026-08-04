#!/bin/bash
# Verify script for 48-service-catalog test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Service Catalog Verification"

SERVICE_ID=$(get_output service_id)
SERVICE_NAME=$(get_output service_name)
SERVICE_COLOR=$(get_output service_color)

echo "  Verifying service via API..."
echo "    Service ID: $SERVICE_ID"

assert_not_empty "$SERVICE_ID" "Service id" || print_failed "Service Catalog Verification"

if ! verify_resource_exists "/api/service" "$SERVICE_ID"; then
    print_failed "Service Catalog Verification"
fi

RESPONSE=$(api_get_resource "/api/service" "$SERVICE_ID" \
    '{"_id": true, "name": true, "description": true, "serviceColor": true}')

validation_failed=0

validate_field "$RESPONSE" "name" "$SERVICE_NAME" || validation_failed=1
validate_field "$RESPONSE" "description" "Service created by Terraform E2E tests" || validation_failed=1
validate_field "$RESPONSE" "serviceColor" "$SERVICE_COLOR" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Service Catalog Verification"
fi

print_passed "Service Catalog Verification"
