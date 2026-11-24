#!/bin/bash
# Verify script for 68-rename-chains-converge (OneUptime/oneuptime#9855):
# every team, label and on-call policy of the chains holds exactly the name
# its configuration gives it, read back from the API.

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

TEST_NAME="${RENAME_CHAINS_TEST_NAME:-Rename Chains Verification}"

print_header "$TEST_NAME"

EXPECTED=$(terraform output -json expected_names 2>/dev/null || echo "[]")
COUNT=$(echo "$EXPECTED" | jq 'length')

if [ "$COUNT" -ne 10 ]; then
    echo "    ✗ FAILED: expected 10 records in the expected_names output, got $COUNT"
    print_failed "$TEST_NAME"
fi

validation_failed=0

for index in $(seq 0 $((COUNT - 1))); do
    label=$(echo "$EXPECTED" | jq -r ".[$index].label")
    endpoint=$(echo "$EXPECTED" | jq -r ".[$index].endpoint")
    id=$(echo "$EXPECTED" | jq -r ".[$index].id")
    name=$(echo "$EXPECTED" | jq -r ".[$index].name")

    echo "  ${label} (${id}): ${name}"

    response=$(api_get_resource "$endpoint" "$id" '{"_id": true, "name": true}')

    validate_field "$response" "name" "$name" || validation_failed=1
done

if [ $validation_failed -eq 1 ]; then
    print_failed "$TEST_NAME"
fi

print_passed "$TEST_NAME"
