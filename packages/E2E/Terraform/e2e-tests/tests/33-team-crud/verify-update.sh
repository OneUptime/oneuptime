#!/bin/bash
# Post-update verify script for 33-team-crud test
# Validates that the updated team fields landed in the API

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Team Update Verification"

BASIC_ID=$(get_output basic_team_id)

echo "  Verifying updated team via API..."
echo "    Basic Team ID: $BASIC_ID"

if ! verify_resource_exists "/api/team" "$BASIC_ID"; then
    print_failed "Team Update Verification"
fi

RESPONSE=$(api_get_resource "/api/team" "$BASIC_ID" '{"_id": true, "name": true, "description": true}')

validation_failed=0

# Name embeds the per-run random suffix, so assert on the updated description
# and the stable "Updated" marker in the name instead of a full literal match.
API_NAME=$(unwrap_value "$(echo "$RESPONSE" | jq '.name')")
if [[ "$API_NAME" != "TF Basic Team Updated "* ]]; then
    echo "    ✗ FAILED: name was not updated - got '$API_NAME'"
    validation_failed=1
else
    echo "    ✓ name carries the update marker: $API_NAME"
fi

validate_field "$RESPONSE" "description" "Basic team updated by the E2E suite" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Team Update Verification"
fi

print_passed "Team Update Verification"
