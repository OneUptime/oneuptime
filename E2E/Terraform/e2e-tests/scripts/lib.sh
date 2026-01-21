#!/bin/bash
# Common library functions for Terraform E2E tests
# Source this file in verify.sh scripts: source "$(dirname "$0")/../../scripts/lib.sh"

#######################################
# Helper Functions
#######################################

# Unwrap API values that might be in wrapper format
# e.g., {"_type": "Color", "value": "#FF5733"} -> "#FF5733"
# Usage: unwrap_value "$raw_json_value"
unwrap_value() {
    local raw_value="$1"
    if echo "$raw_value" | jq -e '.value' > /dev/null 2>&1; then
        echo "$raw_value" | jq -r '.value'
    else
        echo "$raw_value" | jq -r '.'
    fi
}

# Get a Terraform output value safely (returns empty string if not found)
# Usage: get_output "output_name"
get_output() {
    local output_name="$1"
    terraform output -raw "$output_name" 2>/dev/null || echo ""
}

# Assert that a value is not empty
# Usage: assert_not_empty "$value" "Resource name"
assert_not_empty() {
    local value="$1"
    local name="$2"
    if [ -z "$value" ] || [ "$value" = "null" ]; then
        echo "    ✗ FAILED: $name is empty or null"
        return 1
    fi
    echo "    ✓ $name exists: $value"
    return 0
}

# Assert two values are equal
# Usage: assert_equals "$expected" "$actual" "Field name"
assert_equals() {
    local expected="$1"
    local actual="$2"
    local name="$3"
    if [ "$expected" != "$actual" ]; then
        echo "    ✗ FAILED: $name mismatch - Expected: '$expected', Got: '$actual'"
        return 1
    fi
    echo "    ✓ $name matches: $actual"
    return 0
}

# Make an API call to get a resource
# Usage: api_get_resource "endpoint" "resource_id" "select_fields"
# Example: api_get_resource "/api/label" "$LABEL_ID" '{"_id": true, "name": true}'
api_get_resource() {
    local endpoint="$1"
    local resource_id="$2"
    local select_fields="${3:-'{\"_id\": true}'}"

    curl -s -X POST "${ONEUPTIME_URL}${endpoint}/${resource_id}/get-item" \
        -H "Content-Type: application/json" \
        -H "Apikey: $TF_VAR_api_key" \
        -H "projectid: $TF_VAR_project_id" \
        -d "{\"select\": $select_fields}"
}

# Verify a resource exists in the API
# Usage: verify_resource_exists "endpoint" "resource_id"
verify_resource_exists() {
    local endpoint="$1"
    local resource_id="$2"

    local response
    response=$(api_get_resource "$endpoint" "$resource_id" '{"_id": true}')

    local api_id
    api_id=$(echo "$response" | jq -r '._id // empty')

    if [ -z "$api_id" ] || [ "$api_id" = "null" ]; then
        echo "    ✗ FAILED: Resource not found in API"
        echo "    Response: $response"
        return 1
    fi
    echo "    ✓ Resource exists in API"
    return 0
}

# Run idempotency check (terraform plan should show no changes)
# Usage: check_idempotency [strict]
# If strict=true, fails on any changes. Otherwise just warns.
check_idempotency() {
    local strict="${1:-false}"

    echo ""
    echo "  === Verifying idempotency ==="

    local plan_output
    local plan_exit_code
    plan_output=$(terraform plan -detailed-exitcode 2>&1) || plan_exit_code=$?
    plan_exit_code=${plan_exit_code:-0}

    if [ "$plan_exit_code" -eq 0 ]; then
        echo "  ✓ No changes detected - idempotency test PASSED"
        return 0
    elif [ "$plan_exit_code" -eq 2 ]; then
        if [ "$strict" = "true" ]; then
            echo "  ✗ FAILED: Changes detected after apply"
            echo "  Plan output:"
            echo "$plan_output"
            return 1
        else
            echo "  ⚠ WARNING: Changes detected after apply"
            echo "  This may indicate server defaults are being injected"
            echo "  Plan output:"
            echo "$plan_output"
            return 0
        fi
    else
        echo "  ✗ FAILED: terraform plan failed with exit code $plan_exit_code"
        echo "$plan_output"
        return 1
    fi
}

# Validate a field from API response against expected value
# Handles wrapper object unwrapping automatically
# Usage: validate_field "$response" "field_name" "$expected_value"
validate_field() {
    local response="$1"
    local field_name="$2"
    local expected_value="$3"

    local raw_value
    raw_value=$(echo "$response" | jq ".$field_name")

    local actual_value
    actual_value=$(unwrap_value "$raw_value")

    assert_equals "$expected_value" "$actual_value" "$field_name"
}

# Print test header
# Usage: print_header "Test Name"
print_header() {
    local test_name="$1"
    echo ""
    echo "=========================================="
    echo "$test_name"
    echo "=========================================="
}

# Print test passed message
# Usage: print_passed "Test Name"
print_passed() {
    local test_name="$1"
    echo ""
    echo "=== $test_name PASSED ==="
}

# Print test failed message and exit
# Usage: print_failed "Test Name"
print_failed() {
    local test_name="$1"
    echo ""
    echo "=== $test_name FAILED ==="
    exit 1
}

#######################################
# Export functions for subshells
#######################################
export -f unwrap_value
export -f get_output
export -f assert_not_empty
export -f assert_equals
export -f api_get_resource
export -f verify_resource_exists
export -f check_idempotency
export -f validate_field
export -f print_header
export -f print_passed
export -f print_failed
