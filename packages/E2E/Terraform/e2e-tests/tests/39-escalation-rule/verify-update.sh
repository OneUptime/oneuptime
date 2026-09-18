#!/bin/bash
# Post-update verify script for 39-escalation-rule test
# Validates that the updated field values landed in the API

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Escalation Rule Update Verification"

RULE_ID=$(get_output on_call_duty_policy_escalation_rule_id)

if ! verify_resource_exists "/api/on-call-duty-policy-escalation-rule" "$RULE_ID"; then
    print_failed "Escalation Rule Update Verification"
fi

RESPONSE=$(api_get_resource "/api/on-call-duty-policy-escalation-rule" "$RULE_ID" \
    '{"_id": true, "name": true, "description": true, "escalateAfterInMinutes": true}')

validation_failed=0

validate_field "$RESPONSE" "name" "terraform-e2e-escalation-rule-updated" || validation_failed=1
validate_field "$RESPONSE" "description" "Escalation rule updated by Terraform E2E tests" || validation_failed=1
validate_field "$RESPONSE" "escalateAfterInMinutes" "10" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Escalation Rule Update Verification"
fi

print_passed "Escalation Rule Update Verification"
