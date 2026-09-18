#!/bin/bash
# Post-update verify script for 50-telemetry-ingestion-key test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Telemetry Ingestion Key Update Verification"

KEY_ID=$(get_output telemetry_ingestion_key_id)

RESPONSE=$(api_get_resource "/api/telemetry-ingestion-key" "$KEY_ID" \
    '{"_id": true, "name": true, "description": true}')

validation_failed=0

validate_field "$RESPONSE" "name" "terraform-e2e-ingestion-key-updated" || validation_failed=1
validate_field "$RESPONSE" "description" "Telemetry ingestion key updated by Terraform E2E tests" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Telemetry Ingestion Key Update Verification"
fi

print_passed "Telemetry Ingestion Key Update Verification"
