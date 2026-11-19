#!/bin/bash
# Verify script for 67-monitor-secret-type-change
#
# The secret was created as Text. Records its ID, so verify-update.sh can
# tell that update.tf changed its type in place rather than replacing it.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Monitor Secret Type Verification"

SECRET_ID=$(get_output monitor_secret_id)
SECRET_NAME=$(get_output monitor_secret_name)

echo "  Verifying monitor secret via API..."
echo "    Monitor Secret ID: $SECRET_ID"

if ! verify_resource_exists "/api/monitor-secret" "$SECRET_ID"; then
    print_failed "Monitor Secret Type Verification"
fi

RESPONSE=$(api_get_resource "/api/monitor-secret" "$SECRET_ID" '{"_id": true, "name": true, "secretType": true}')

validation_failed=0
validate_field "$RESPONSE" "name" "$SECRET_NAME" || validation_failed=1
validate_field "$RESPONSE" "secretType" "Text" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Monitor Secret Type Verification"
fi

# The ID the update must keep.
echo "$SECRET_ID" > "${TMPDIR:-/tmp}/oneuptime-e2e-monitor-secret-${SECRET_ID}"

print_passed "Monitor Secret Type Verification"
