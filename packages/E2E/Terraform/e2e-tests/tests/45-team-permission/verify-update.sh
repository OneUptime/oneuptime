#!/bin/bash
# Post-update verify script for 45-team-permission test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Team Permission Update Verification"

PERMISSION_ID=$(get_output team_permission_id)

RESPONSE=$(api_get_resource "/api/team-permission" "$PERMISSION_ID" \
    '{"_id": true, "permission": true, "scope": true}')

validation_failed=0

validate_field "$RESPONSE" "permission" "EditProjectMonitor" || validation_failed=1
validate_field "$RESPONSE" "scope" "Owned" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Team Permission Update Verification"
fi

print_passed "Team Permission Update Verification"
