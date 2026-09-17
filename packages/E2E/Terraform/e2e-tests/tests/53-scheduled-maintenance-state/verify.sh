#!/bin/bash
# Verify script for 53-scheduled-maintenance-state test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Scheduled Maintenance State Verification"

STATE_ID=$(get_output scheduled_maintenance_state_id)
STATE_NAME=$(get_output scheduled_maintenance_state_name)
STATE_COLOR=$(get_output scheduled_maintenance_state_color)

echo "  Verifying scheduled maintenance state via API..."
echo "    State ID: $STATE_ID"

assert_not_empty "$STATE_ID" "Scheduled maintenance state id" || print_failed "Scheduled Maintenance State Verification"

if ! verify_resource_exists "/api/scheduled-maintenance-state" "$STATE_ID"; then
    print_failed "Scheduled Maintenance State Verification"
fi

RESPONSE=$(api_get_resource "/api/scheduled-maintenance-state" "$STATE_ID" \
    '{"_id": true, "name": true, "description": true, "color": true}')

validation_failed=0

validate_field "$RESPONSE" "name" "$STATE_NAME" || validation_failed=1
validate_field "$RESPONSE" "description" "Scheduled maintenance state created by Terraform E2E tests" || validation_failed=1
validate_field "$RESPONSE" "color" "$STATE_COLOR" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Scheduled Maintenance State Verification"
fi

print_passed "Scheduled Maintenance State Verification"
