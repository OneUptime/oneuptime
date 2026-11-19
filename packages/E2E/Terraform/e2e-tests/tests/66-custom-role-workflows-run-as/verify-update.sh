#!/bin/bash
# Post-update verify script for 66-custom-role-workflows-run-as
#
# update.tf dropped the role "deleted". Its delete said its workflows run as
# "other" instead, so the role is gone and the workflow verify.sh made runs
# as "other" now, rather than stopping. The workflow is then deleted: no
# configuration manages it.

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Custom Role Workflows Run As Post-Update Verification"

OTHER_ROLE_ID=$(get_output custom_role_id)
assert_not_empty "$OTHER_ROLE_ID" "Other role id" || print_failed "Custom Role Workflows Run As Post-Update Verification"

validation_failed=0

# The workflow verify.sh made: the one that runs as "other" now.
LIST_RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/workflow/get-list" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d "{
        \"query\": {\"name\": \"terraform-e2e-runs-as-role\", \"runAsCustomRoleId\": \"$OTHER_ROLE_ID\"},
        \"select\": {\"_id\": true, \"runAs\": true, \"runAsCustomRoleId\": true},
        \"limit\": 10
    }")
WORKFLOW_COUNT=$(echo "$LIST_RESPONSE" | jq -r '.data | length')
WORKFLOW_ID=$(echo "$LIST_RESPONSE" | jq -r '.data[0]._id // empty')

if ! assert_equals "1" "$WORKFLOW_COUNT" "Workflows that run as the other role"; then
    echo "    Response: $LIST_RESPONSE"
    print_failed "Custom Role Workflows Run As Post-Update Verification"
fi

validate_field "$(echo "$LIST_RESPONSE" | jq -c '.data[0]')" "runAs" "CustomRole" || validation_failed=1

# The role the workflow ran as is gone: the runner checks only *_id outputs.
DELETED_RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/custom-role/get-list" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"query": {"name": "terraform-e2e-workflows-run-as-role"}, "select": {"_id": true}, "limit": 10}')
assert_equals "0" "$(echo "$DELETED_RESPONSE" | jq -r '.data | length')" "Roles named terraform-e2e-workflows-run-as-role" || validation_failed=1

# No configuration manages the workflow: delete it here.
echo "  Deleting the workflow..."
curl -s -X DELETE "${ONEUPTIME_URL}/api/workflow/${WORKFLOW_ID}" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" >/dev/null

GONE=$(api_get_resource "/api/workflow" "$WORKFLOW_ID" '{"_id": true}')
if echo "$GONE" | grep -q '"_id"'; then
    echo "    ✗ FAILED: the workflow is still there: $GONE"
    validation_failed=1
else
    echo "    ✓ Workflow deleted"
fi

if [ $validation_failed -eq 1 ]; then
    print_failed "Custom Role Workflows Run As Post-Update Verification"
fi

print_passed "Custom Role Workflows Run As Post-Update Verification"
