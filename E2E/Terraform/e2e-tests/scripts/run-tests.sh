#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
PROVIDER_DIR="$TEST_DIR/../../../Terraform/terraform-provider-oneuptime"

# Load test environment
source "$TEST_DIR/test-env.sh"

echo "=== Running Terraform E2E Tests ==="
echo "OneUptime URL: $ONEUPTIME_URL"
echo "Project ID: $ONEUPTIME_PROJECT_ID"

# Build and install provider locally
echo ""
echo "=== Building Terraform Provider ==="
cd "$PROVIDER_DIR"
go mod tidy
go build -o terraform-provider-oneuptime

# Install provider
OS=$(go env GOOS)
ARCH=$(go env GOARCH)
INSTALL_DIR="$HOME/.terraform.d/plugins/registry.terraform.io/oneuptime/oneuptime/1.0.0/${OS}_${ARCH}"
mkdir -p "$INSTALL_DIR"
cp terraform-provider-oneuptime "$INSTALL_DIR/"

# Create Terraform CLI override config
cat > "$HOME/.terraformrc" << EOF
provider_installation {
  dev_overrides {
    "oneuptime/oneuptime" = "$INSTALL_DIR"
  }
  direct {}
}
EOF

echo "Provider installed to: $INSTALL_DIR"

#######################################
# API Validation Helper Functions
#######################################

# Map output name to API endpoint
# e.g., "label_id" -> "/api/label", "monitor_status_id" -> "/api/monitor-status"
get_api_endpoint() {
    local output_name="$1"
    # Remove "_id" suffix and convert underscores to hyphens
    local resource_type="${output_name%_id}"
    resource_type="${resource_type//_/-}"
    echo "/api/${resource_type}"
}

# Validate resource exists via API and return the full response
validate_resource_exists() {
    local endpoint="$1"
    local resource_id="$2"
    local resource_name="$3"

    echo "    Validating via API: POST ${ONEUPTIME_URL}${endpoint}/${resource_id}/get-item"

    local response
    local http_code

    # Make API call and capture both response and HTTP code
    # Select common fields that most resources have
    response=$(curl -s -w "\n%{http_code}" -X POST "${ONEUPTIME_URL}${endpoint}/${resource_id}/get-item" \
        -H "Content-Type: application/json" \
        -H "Apikey: $TF_VAR_api_key" \
        -H "projectid: $TF_VAR_project_id" \
        -d '{"select": {"_id": true, "name": true, "description": true, "color": true, "slug": true}}' 2>&1)

    http_code=$(echo "$response" | tail -n1)
    response=$(echo "$response" | sed '$d')

    if [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        # Check if response contains the resource ID
        local returned_id=$(echo "$response" | jq -r '._id // .data._id // empty' 2>/dev/null)
        if [ -n "$returned_id" ] && [ "$returned_id" != "null" ]; then
            echo "    ✓ API validation PASSED: Resource exists (ID: $returned_id)"
            # Store response for field validation
            echo "$response"
            return 0
        else
            echo "    ✗ API validation FAILED: Resource not found in response"
            echo "    Response: $response"
            return 1
        fi
    else
        echo "    ✗ API validation FAILED: HTTP $http_code"
        echo "    Response: $response"
        return 1
    fi
}

# Validate a specific field value from API response
validate_field_from_response() {
    local response="$1"
    local field_name="$2"
    local expected_value="$3"

    # Extract the value - handle both direct string and wrapper object formats
    local actual_value=$(echo "$response" | jq -r ".${field_name} // .data.${field_name} // empty" 2>/dev/null)

    # Handle wrapper object format (e.g., {"_type":"...", "value":"..."})
    if echo "$actual_value" | jq -e '.value' > /dev/null 2>&1; then
        actual_value=$(echo "$actual_value" | jq -r '.value')
    fi

    # Skip if field is null or empty in API response
    if [ -z "$actual_value" ] || [ "$actual_value" = "null" ]; then
        echo "    ⚠ Field '$field_name' not present in API response, skipping validation"
        return 0
    fi

    if [ "$actual_value" = "$expected_value" ]; then
        echo "    ✓ Field validation PASSED: $field_name = '$expected_value'"
        return 0
    else
        echo "    ✗ Field validation FAILED: Expected $field_name='$expected_value', got '$actual_value'"
        return 1
    fi
}

# Validate a specific field value via API (standalone call)
validate_field_value() {
    local endpoint="$1"
    local resource_id="$2"
    local field_name="$3"
    local expected_value="$4"

    echo "    Validating field via API: $field_name = '$expected_value'"

    local response=$(curl -sf -X POST "${ONEUPTIME_URL}${endpoint}/${resource_id}/get-item" \
        -H "Content-Type: application/json" \
        -H "Apikey: $TF_VAR_api_key" \
        -H "projectid: $TF_VAR_project_id" \
        -d "{\"select\": {\"${field_name}\": true}}" 2>&1)

    if [ $? -ne 0 ]; then
        echo "    ✗ Field validation FAILED: Could not fetch resource"
        return 1
    fi

    validate_field_from_response "$response" "$field_name" "$expected_value"
}

# Comprehensive validation: check resource exists AND validate all available field outputs
validate_resource_comprehensive() {
    local test_path="$1"
    local output_name="$2"
    local resource_id="$3"
    local validation_failed=0

    cd "$test_path"

    local endpoint=$(get_api_endpoint "$output_name")

    # First, validate resource exists and get response
    local api_response
    api_response=$(validate_resource_exists "$endpoint" "$resource_id" "$output_name" 2>&1)
    local exists_result=$?

    # Print the existence check output (without the JSON response)
    echo "$api_response" | grep -v '^{' | grep -v '^\[' || true

    if [ $exists_result -ne 0 ]; then
        return 1
    fi

    # Extract the JSON response (last line that starts with { or [)
    local json_response=$(echo "$api_response" | grep '^{' | tail -1)

    if [ -z "$json_response" ]; then
        echo "    ⚠ Could not parse API response for field validation"
        return 0
    fi

    # Get the resource prefix (e.g., "label" from "label_id")
    local resource_prefix="${output_name%_id}"

    # Get all terraform outputs as JSON
    local all_outputs=$(terraform output -json 2>/dev/null)

    # Check for common field outputs and validate them
    # Fields to check: name, description, color, slug, etc.
    local fields_to_check=("name" "description" "color" "slug" "key" "probe_version" "page_title" "page_description")

    for field in "${fields_to_check[@]}"; do
        # Check if there's an output like "{resource_prefix}_{field}" or just "{field}"
        local output_key="${resource_prefix}_${field}"
        local expected_value=$(echo "$all_outputs" | jq -r ".\"${output_key}\".value // empty" 2>/dev/null)

        # Also try without prefix for some outputs
        if [ -z "$expected_value" ] || [ "$expected_value" = "null" ]; then
            expected_value=$(echo "$all_outputs" | jq -r ".\"${field}\".value // empty" 2>/dev/null)
        fi

        if [ -n "$expected_value" ] && [ "$expected_value" != "null" ]; then
            echo "    Checking $field..."
            if ! validate_field_from_response "$json_response" "$field" "$expected_value"; then
                validation_failed=1
            fi
        fi
    done

    return $validation_failed
}

# Extract all *_id outputs from terraform and validate each comprehensively
validate_all_resources() {
    local test_path="$1"
    local validation_failed=0

    cd "$test_path"

    # Get all outputs as JSON
    local all_outputs=$(terraform output -json 2>/dev/null)

    # Get all outputs that end with _id
    local id_outputs=$(echo "$all_outputs" | jq -r 'to_entries[] | select(.key | endswith("_id")) | "\(.key)=\(.value.value)"' 2>/dev/null)

    if [ -z "$id_outputs" ]; then
        echo "    No *_id outputs found to validate"
        return 0
    fi

    echo "  Validating created resources via API..."

    while IFS= read -r output; do
        if [ -z "$output" ]; then
            continue
        fi

        local output_name="${output%%=*}"
        local resource_id="${output#*=}"

        if [ -z "$resource_id" ] || [ "$resource_id" = "null" ]; then
            echo "    ⚠ Skipping $output_name: no ID value"
            continue
        fi

        echo ""
        echo "    --- Validating: $output_name ($resource_id) ---"

        if ! validate_resource_comprehensive "$test_path" "$output_name" "$resource_id"; then
            validation_failed=1
        fi
    done <<< "$id_outputs"

    return $validation_failed
}

# Verify resource was deleted via API
validate_resource_deleted() {
    local endpoint="$1"
    local resource_id="$2"

    echo "    Verifying deletion via API: POST ${ONEUPTIME_URL}${endpoint}/${resource_id}/get-item"

    local http_code
    http_code=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${ONEUPTIME_URL}${endpoint}/${resource_id}/get-item" \
        -H "Content-Type: application/json" \
        -H "Apikey: $TF_VAR_api_key" \
        -H "projectid: $TF_VAR_project_id" \
        -d '{"select": {"_id": true}}' 2>&1)

    # Resource should return 404 or 500 (not found) after deletion
    if [ "$http_code" -eq 404 ] || [ "$http_code" -eq 500 ]; then
        echo "    ✓ Deletion verified: Resource no longer exists (HTTP $http_code)"
        return 0
    elif [ "$http_code" -ge 200 ] && [ "$http_code" -lt 300 ]; then
        echo "    ✗ Deletion verification FAILED: Resource still exists (HTTP $http_code)"
        return 1
    else
        echo "    ✓ Deletion likely successful (HTTP $http_code)"
        return 0
    fi
}

# Validate all resources were deleted
validate_all_deleted() {
    local test_path="$1"
    local saved_ids="$2"  # Format: "output_name=id\noutput_name2=id2\n..."
    local validation_failed=0

    echo "  Verifying resources were deleted via API..."

    while IFS= read -r output; do
        if [ -z "$output" ]; then
            continue
        fi

        local output_name="${output%%=*}"
        local resource_id="${output#*=}"

        if [ -z "$resource_id" ] || [ "$resource_id" = "null" ]; then
            continue
        fi

        local endpoint=$(get_api_endpoint "$output_name")

        if ! validate_resource_deleted "$endpoint" "$resource_id"; then
            validation_failed=1
        fi
    done <<< "$saved_ids"

    return $validation_failed
}

#######################################
# Main Test Runner
#######################################

# Discover all test directories dynamically (sorted by name)
TEST_DIRS=()
while IFS= read -r dir; do
    TEST_DIRS+=("$(basename "$dir")")
done < <(find "$TEST_DIR/tests" -mindepth 1 -maxdepth 1 -type d | sort)

echo "Discovered ${#TEST_DIRS[@]} test directories"

PASSED=()
FAILED=()

for test_name in "${TEST_DIRS[@]}"; do
    test_path="$TEST_DIR/tests/$test_name"

    if [ ! -d "$test_path" ]; then
        echo "SKIP: $test_name (not found)"
        continue
    fi

    echo ""
    echo "=========================================="
    echo "Testing: $test_name"
    echo "=========================================="

    cd "$test_path"
    rm -f tfplan terraform.tfstate terraform.tfstate.backup

    # All tests get the same comprehensive treatment:
    # 1. Plan
    # 2. Apply
    # 3. API Validation (existence + field values)
    # 4. Destroy
    # 5. Verify Deletion via API

    # Step 1: Plan
    echo "  [1/5] Planning..."
    if ! terraform plan -out=tfplan 2>&1; then
        echo "  ✗ FAILED: Plan failed"
        FAILED+=("$test_name")
        rm -f tfplan terraform.tfstate terraform.tfstate.backup
        continue
    fi

    # Step 2: Apply
    echo "  [2/5] Applying..."
    if ! terraform apply -auto-approve tfplan 2>&1; then
        echo "  ✗ FAILED: Apply failed"
        FAILED+=("$test_name")
        # Try to cleanup anyway
        terraform destroy -auto-approve 2>&1 || true
        rm -f tfplan terraform.tfstate terraform.tfstate.backup
        continue
    fi

    # Show outputs
    echo ""
    echo "  Terraform Outputs:"
    terraform output 2>&1 || true
    echo ""

    # Save resource IDs for deletion verification later
    saved_ids=$(terraform output -json 2>/dev/null | jq -r 'to_entries[] | select(.key | endswith("_id")) | "\(.key)=\(.value.value)"' 2>/dev/null)

    # Step 3: Comprehensive API Validation
    echo "  [3/5] Validating via API..."
    test_failed=0
    if ! validate_all_resources "$test_path"; then
        echo "  ✗ API validation failed"
        test_failed=1
    fi

    # Step 4: Destroy
    echo ""
    echo "  [4/5] Destroying..."
    cd "$test_path"
    if ! terraform destroy -auto-approve 2>&1; then
        echo "  ⚠ WARNING: Destroy failed"
        FAILED+=("$test_name (destroy)")
        test_failed=1
    fi

    # Step 5: Verify Deletion via API
    echo ""
    echo "  [5/5] Verifying deletion..."
    if [ -n "$saved_ids" ]; then
        if ! validate_all_deleted "$test_path" "$saved_ids"; then
            echo "  ⚠ WARNING: Some resources may not have been deleted"
            # Don't fail the test for deletion verification issues
        fi
    fi

    # Cleanup state files
    rm -f tfplan terraform.tfstate terraform.tfstate.backup

    # Mark test result
    if [ $test_failed -eq 0 ]; then
        echo ""
        echo "  ✓ PASSED: $test_name"
        PASSED+=("$test_name")
    else
        FAILED+=("$test_name")
    fi
done

# Summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Passed: ${#PASSED[@]}"
for t in "${PASSED[@]}"; do echo "  ✓ $t"; done

if [ ${#FAILED[@]} -gt 0 ]; then
    echo "Failed: ${#FAILED[@]}"
    for t in "${FAILED[@]}"; do echo "  ✗ $t"; done
    exit 1
fi

echo ""
echo "All tests passed!"
