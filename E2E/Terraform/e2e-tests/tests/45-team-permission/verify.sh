#!/bin/bash
# Verify script for 45-team-permission test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Team Permission Verification"

TEAM_ID=$(get_output team_id)
PERMISSION_ID=$(get_output team_permission_id)

echo "  Verifying team permission via API..."
echo "    Team ID: $TEAM_ID"
echo "    Permission ID: $PERMISSION_ID"

assert_not_empty "$TEAM_ID" "Team id" || print_failed "Team Permission Verification"
assert_not_empty "$PERMISSION_ID" "Team permission id" || print_failed "Team Permission Verification"

if ! verify_resource_exists "/api/team-permission" "$PERMISSION_ID"; then
    print_failed "Team Permission Verification"
fi

RESPONSE=$(api_get_resource "/api/team-permission" "$PERMISSION_ID" \
    '{"_id": true, "permission": true, "teamId": true}')

validation_failed=0

validate_field "$RESPONSE" "permission" "ReadProjectMonitor" || validation_failed=1

API_TEAM_ID=$(echo "$RESPONSE" | jq -r '.teamId // empty')
assert_equals "$TEAM_ID" "$API_TEAM_ID" "teamId" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Team Permission Verification"
fi

print_passed "Team Permission Verification"
