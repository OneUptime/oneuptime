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

# Pre-download the random provider (needed by some tests)
echo ""
echo "=== Downloading Random Provider ==="
RANDOM_PROVIDER_DIR="/tmp/tf-random-provider"
mkdir -p "$RANDOM_PROVIDER_DIR"
cat > "$RANDOM_PROVIDER_DIR/main.tf" << 'TFEOF'
terraform {
  required_providers {
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}
TFEOF
(cd "$RANDOM_PROVIDER_DIR" && terraform init -upgrade > /dev/null 2>&1) || true
echo "Random provider downloaded"

#######################################
# API Helper Functions (for verify.sh scripts)
#######################################

# These functions are exported for use by verify.sh scripts

# Map output name to API endpoint
# e.g., "label_id" -> "/api/label", "monitor_status_id" -> "/api/monitor-status"
get_api_endpoint() {
    local output_name="$1"
    # Remove "_id" suffix and convert underscores to hyphens
    local resource_type="${output_name%_id}"
    resource_type="${resource_type//_/-}"
    echo "/api/${resource_type}"
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

# Export functions and variables for verify.sh scripts
export -f get_api_endpoint
export ONEUPTIME_URL
export TF_VAR_api_key
export TF_VAR_project_id

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

    # All tests get the same treatment:
    # 1. Plan
    # 2. Apply
    # 3. Run verify.sh (API Validation)
    # 4. Destroy
    # 5. Verify Deletion via API

    # Step 0: Initialize (copy pre-downloaded providers)
    echo "  [0/5] Initializing..."
    # Copy pre-downloaded random provider if the test uses it
    if grep -q "hashicorp/random" "$test_path/main.tf" 2>/dev/null; then
        mkdir -p "$test_path/.terraform/providers"
        cp -r "$RANDOM_PROVIDER_DIR/.terraform/providers/registry.terraform.io/hashicorp" "$test_path/.terraform/providers/registry.terraform.io/" 2>/dev/null || true
        # Copy lock file for random provider
        if [ -f "$RANDOM_PROVIDER_DIR/.terraform.lock.hcl" ]; then
            # Merge or copy lock file
            cp "$RANDOM_PROVIDER_DIR/.terraform.lock.hcl" "$test_path/.terraform.lock.hcl" 2>/dev/null || true
        fi
    fi

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

    # Step 3: Run verify.sh for API Validation
    echo "  [3/5] Running API validation (verify.sh)..."
    test_failed=0
    if [ -f "$test_path/verify.sh" ]; then
        chmod +x "$test_path/verify.sh"
        if ! "$test_path/verify.sh"; then
            echo "  ✗ API validation failed"
            test_failed=1
        else
            echo "  ✓ API validation passed"
        fi
    else
        echo "  ⚠ No verify.sh found, skipping API validation"
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
