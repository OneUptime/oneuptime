#!/bin/bash
# Post-update verify script for 40-on-call-schedule test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "On-Call Schedule Update Verification"

SCHEDULE_ID=$(get_output on_call_duty_policy_schedule_id)
LAYER_ID=$(get_output on_call_duty_schedule_layer_id)

SCHEDULE_RESPONSE=$(api_get_resource "/api/on-call-duty-policy-schedule" "$SCHEDULE_ID" \
    '{"_id": true, "name": true, "description": true}')
LAYER_RESPONSE=$(api_get_resource "/api/on-call-duty-schedule-layer" "$LAYER_ID" \
    '{"_id": true, "name": true, "description": true}')

validation_failed=0

validate_field "$SCHEDULE_RESPONSE" "description" "On-call schedule updated by Terraform E2E tests" || validation_failed=1
validate_field "$LAYER_RESPONSE" "name" "terraform-e2e-schedule-layer-updated" || validation_failed=1
validate_field "$LAYER_RESPONSE" "description" "Layer updated by Terraform E2E tests" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "On-Call Schedule Update Verification"
fi

print_passed "On-Call Schedule Update Verification"
