#!/bin/bash
# Post-update verify script for 47-workflow test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Workflow Update Verification"

WORKFLOW_ID=$(get_output workflow_id)
VARIABLE_ID=$(get_output workflow_variable_id)

WORKFLOW_RESPONSE=$(api_get_resource "/api/workflow" "$WORKFLOW_ID" \
    '{"_id": true, "name": true, "description": true}')
VARIABLE_RESPONSE=$(api_get_resource "/api/workflow-variable" "$VARIABLE_ID" \
    '{"_id": true, "content": true}')

validation_failed=0

validate_field "$WORKFLOW_RESPONSE" "name" "terraform-e2e-workflow-updated" || validation_failed=1
validate_field "$WORKFLOW_RESPONSE" "description" "Workflow updated by Terraform E2E tests" || validation_failed=1
validate_field "$VARIABLE_RESPONSE" "content" "updated-value" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Workflow Update Verification"
fi

print_passed "Workflow Update Verification"
