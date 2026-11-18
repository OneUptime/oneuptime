#!/bin/bash
# Verify script for 64-ordered-lists-converge (OneUptime/oneuptime#9573):
# every row of the four numbered lists holds exactly the order its
# configuration gives it, read back from the API.

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

TEST_NAME="${ORDERED_LISTS_TEST_NAME:-Numbered Lists Verification}"

print_header "$TEST_NAME"

EXPECTED=$(terraform output -json expected_orders 2>/dev/null || echo "[]")
COUNT=$(echo "$EXPECTED" | jq 'length')

if [ "$COUNT" -eq 0 ]; then
    echo "    ✗ FAILED: no rows in the expected_orders output"
    print_failed "$TEST_NAME"
fi

validation_failed=0

for index in $(seq 0 $((COUNT - 1))); do
    label=$(echo "$EXPECTED" | jq -r ".[$index].label")
    endpoint=$(echo "$EXPECTED" | jq -r ".[$index].endpoint")
    id=$(echo "$EXPECTED" | jq -r ".[$index].id")
    order=$(echo "$EXPECTED" | jq -r ".[$index].order")

    echo "  ${label} (${id}): order ${order}"

    response=$(api_get_resource "$endpoint" "$id" '{"_id": true, "order": true}')

    validate_field "$response" "order" "$order" || validation_failed=1
done

if [ $validation_failed -eq 1 ]; then
    print_failed "$TEST_NAME"
fi

print_passed "$TEST_NAME"
