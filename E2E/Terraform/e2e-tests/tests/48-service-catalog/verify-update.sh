#!/bin/bash
# Post-update verify script for 48-service-catalog test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Service Catalog Update Verification"

SERVICE_ID=$(get_output service_id)

RESPONSE=$(api_get_resource "/api/service" "$SERVICE_ID" \
    '{"_id": true, "description": true, "serviceColor": true}')

validation_failed=0

validate_field "$RESPONSE" "description" "Service updated by Terraform E2E tests" || validation_failed=1
validate_field "$RESPONSE" "serviceColor" "#3498DB" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Service Catalog Update Verification"
fi

print_passed "Service Catalog Update Verification"
