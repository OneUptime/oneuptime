#!/bin/bash
# Verify script for 47-workflow test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Workflow Verification"

WORKFLOW_ID=$(get_output workflow_id)
VARIABLE_ID=$(get_output workflow_variable_id)
WORKFLOW_NAME=$(get_output workflow_name)

echo "  Verifying workflow via API..."
echo "    Workflow ID: $WORKFLOW_ID"
echo "    Variable ID: $VARIABLE_ID"

assert_not_empty "$WORKFLOW_ID" "Workflow id" || print_failed "Workflow Verification"
assert_not_empty "$VARIABLE_ID" "Workflow variable id" || print_failed "Workflow Verification"

if ! verify_resource_exists "/api/workflow" "$WORKFLOW_ID"; then
    print_failed "Workflow Verification"
fi

if ! verify_resource_exists "/api/workflow-variable" "$VARIABLE_ID"; then
    print_failed "Workflow Verification"
fi

WORKFLOW_RESPONSE=$(api_get_resource "/api/workflow" "$WORKFLOW_ID" \
    '{"_id": true, "name": true, "description": true, "isEnabled": true}')
# NOTE: content is deliberately NOT selected — workflow variables can hold
# secrets, so the content column has no read permissions and selecting it
# rejects the whole request. The provider treats it as write-only for the
# same reason.
VARIABLE_RESPONSE=$(api_get_resource "/api/workflow-variable" "$VARIABLE_ID" \
    '{"_id": true, "name": true, "workflowId": true}')

validation_failed=0

validate_field "$WORKFLOW_RESPONSE" "name" "$WORKFLOW_NAME" || validation_failed=1
validate_field "$WORKFLOW_RESPONSE" "isEnabled" "false" || validation_failed=1
validate_field "$VARIABLE_RESPONSE" "name" "terraform-e2e-variable" || validation_failed=1

# The variable must belong to the workflow created in this fixture
# workflowId comes back as an ObjectID wrapper ({_type, value}); unwrap it.
API_WORKFLOW_ID=$(echo "$VARIABLE_RESPONSE" | jq -r '(.workflowId.value // .workflowId) // empty')
assert_equals "$WORKFLOW_ID" "$API_WORKFLOW_ID" "workflowId" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Workflow Verification"
fi

print_passed "Workflow Verification"
