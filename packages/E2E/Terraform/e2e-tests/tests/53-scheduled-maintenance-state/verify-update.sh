#!/bin/bash
# Post-update verify script for 53-scheduled-maintenance-state test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Scheduled Maintenance State Update Verification"

STATE_ID=$(get_output scheduled_maintenance_state_id)

RESPONSE=$(api_get_resource "/api/scheduled-maintenance-state" "$STATE_ID" \
    '{"_id": true, "name": true, "description": true, "color": true}')

validation_failed=0

validate_field "$RESPONSE" "name" "terraform-e2e-maintenance-state-updated" || validation_failed=1
validate_field "$RESPONSE" "description" "Scheduled maintenance state updated by Terraform E2E tests" || validation_failed=1
validate_field "$RESPONSE" "color" "#16A085" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Scheduled Maintenance State Update Verification"
fi

print_passed "Scheduled Maintenance State Update Verification"
