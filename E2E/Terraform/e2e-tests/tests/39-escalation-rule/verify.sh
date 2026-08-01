#!/bin/bash
# Verify script for 39-escalation-rule test
# Validates that the escalation rule was created and wired to the policy

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Escalation Rule Verification"

POLICY_ID=$(get_output on_call_duty_policy_id)
RULE_ID=$(get_output on_call_duty_policy_escalation_rule_id)
RULE_NAME=$(get_output escalation_rule_name)

echo "  Verifying escalation rule via API..."
echo "    Policy ID: $POLICY_ID"
echo "    Rule ID: $RULE_ID"

assert_not_empty "$POLICY_ID" "On-call policy id" || print_failed "Escalation Rule Verification"
assert_not_empty "$RULE_ID" "Escalation rule id" || print_failed "Escalation Rule Verification"

if ! verify_resource_exists "/api/on-call-duty-policy-escalation-rule" "$RULE_ID"; then
    print_failed "Escalation Rule Verification"
fi

RESPONSE=$(api_get_resource "/api/on-call-duty-policy-escalation-rule" "$RULE_ID" \
    '{"_id": true, "name": true, "description": true, "escalateAfterInMinutes": true, "onCallDutyPolicyId": true}')

validation_failed=0

validate_field "$RESPONSE" "name" "$RULE_NAME" || validation_failed=1
validate_field "$RESPONSE" "description" "Escalation rule created by Terraform E2E tests" || validation_failed=1
validate_field "$RESPONSE" "escalateAfterInMinutes" "5" || validation_failed=1

# The rule must be attached to the policy created in this fixture
API_POLICY_ID=$(echo "$RESPONSE" | jq -r '(.onCallDutyPolicyId | if type == "object" then .value else . end) // empty')
assert_equals "$POLICY_ID" "$API_POLICY_ID" "onCallDutyPolicyId" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Escalation Rule Verification"
fi

print_passed "Escalation Rule Verification"
