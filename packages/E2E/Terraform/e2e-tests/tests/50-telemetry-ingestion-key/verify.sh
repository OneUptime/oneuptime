#!/bin/bash
# Verify script for 50-telemetry-ingestion-key test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Telemetry Ingestion Key Verification"

KEY_ID=$(get_output telemetry_ingestion_key_id)
KEY_NAME=$(get_output telemetry_ingestion_key_name)

echo "  Verifying telemetry ingestion key via API..."
echo "    Key ID: $KEY_ID"

assert_not_empty "$KEY_ID" "Telemetry ingestion key id" || print_failed "Telemetry Ingestion Key Verification"

if ! verify_resource_exists "/api/telemetry-ingestion-key" "$KEY_ID"; then
    print_failed "Telemetry Ingestion Key Verification"
fi

RESPONSE=$(api_get_resource "/api/telemetry-ingestion-key" "$KEY_ID" \
    '{"_id": true, "name": true, "description": true, "secretKey": true}')

validation_failed=0

validate_field "$RESPONSE" "name" "$KEY_NAME" || validation_failed=1
validate_field "$RESPONSE" "description" "Telemetry ingestion key created by Terraform E2E tests" || validation_failed=1

# secret_key is server-generated; it must exist even though we never set it
SECRET_KEY=$(echo "$RESPONSE" | jq -r '.secretKey // empty' | head -c 8)
assert_not_empty "$SECRET_KEY" "Server-generated secret key" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Telemetry Ingestion Key Verification"
fi

print_passed "Telemetry Ingestion Key Verification"
