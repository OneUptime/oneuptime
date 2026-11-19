#!/bin/bash
# Verify script for 66-custom-role-workflows-run-as
#
# Checks the two roles, then makes a workflow that runs as the role
# "deleted" over the API, as someone would in the Dashboard: no
# configuration manages it, so Terraform cannot change it first - the role's
# delete has to say what it runs as instead. verify-update.sh checks that it
# did, and deletes the workflow.

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Custom Role Workflows Run As Verification"

OTHER_ROLE_ID=$(get_output custom_role_id)
DELETED_ROLE_ID=$(get_output deleted_role)

assert_not_empty "$OTHER_ROLE_ID" "Other role id" || print_failed "Custom Role Workflows Run As Verification"
assert_not_empty "$DELETED_ROLE_ID" "Deleted role id" || print_failed "Custom Role Workflows Run As Verification"

for ROLE_ID in "$OTHER_ROLE_ID" "$DELETED_ROLE_ID"; do
    if ! verify_resource_exists "/api/custom-role" "$ROLE_ID"; then
        print_failed "Custom Role Workflows Run As Verification"
    fi
done

DELETED_RESPONSE=$(api_get_resource "/api/custom-role" "$DELETED_ROLE_ID" '{"_id": true, "name": true}')

validation_failed=0
validate_field "$DELETED_RESPONSE" "name" "terraform-e2e-workflows-run-as-role" || validation_failed=1

# What its delete says is the provider's alone: nothing of it reaches the role.
for FIELD in workflowsRunAs workflowsRunAsOnDelete workflowsRunAsCustomRoleIdOnDelete; do
    if echo "$DELETED_RESPONSE" | jq -e --arg field "$FIELD" 'has($field)' >/dev/null 2>&1; then
        echo "    ✗ FAILED: the role holds $FIELD, which only its delete takes"
        validation_failed=1
    fi
done

# A workflow someone built in the Dashboard, running as the role.
echo "  Creating a workflow that runs as the role, over the API..."
WORKFLOW_RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/workflow" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d "{
        \"data\": {
            \"name\": \"terraform-e2e-runs-as-role\",
            \"description\": \"Runs as a custom role Terraform deletes\",
            \"isEnabled\": false,
            \"runAs\": \"CustomRole\",
            \"runAsCustomRoleId\": \"$DELETED_ROLE_ID\"
        }
    }")
WORKFLOW_ID=$(echo "$WORKFLOW_RESPONSE" | jq -r '(.data._id // ._id) // empty')

if ! assert_not_empty "$WORKFLOW_ID" "Workflow id"; then
    echo "    Response: $WORKFLOW_RESPONSE"
    print_failed "Custom Role Workflows Run As Verification"
fi

RUNS_AS=$(api_get_resource "/api/workflow" "$WORKFLOW_ID" '{"_id": true, "runAs": true, "runAsCustomRoleId": true}')
validate_field "$RUNS_AS" "runAs" "CustomRole" || validation_failed=1
RUNS_AS_ROLE=$(echo "$RUNS_AS" | jq -r '(.runAsCustomRoleId.value // .runAsCustomRoleId) // empty')
assert_equals "$DELETED_ROLE_ID" "$RUNS_AS_ROLE" "runAsCustomRoleId" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Custom Role Workflows Run As Verification"
fi

print_passed "Custom Role Workflows Run As Verification"
