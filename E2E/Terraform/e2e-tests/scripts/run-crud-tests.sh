#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
PROVIDER_DIR="$TEST_DIR/../../../Terraform/terraform-provider-oneuptime"

# Load test environment
source "$TEST_DIR/test-env.sh"

echo "=== Running Terraform CRUD E2E Tests ==="
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

echo "Provider installed to: $INSTALL_DIR"

# Helper function to validate resource via API
validate_api() {
    local endpoint="$1"
    local resource_id="$2"
    local expected_field="$3"
    local expected_value="$4"

    echo "    Validating via API: GET $endpoint/$resource_id"

    local response=$(curl -sf -X POST "${ONEUPTIME_URL}/api${endpoint}/${resource_id}/get-item" \
        -H "Content-Type: application/json" \
        -H "Apikey: $TF_VAR_api_key" \
        -H "projectid: $TF_VAR_project_id" \
        -d "{\"select\": {\"${expected_field}\": true}}" 2>&1)

    if [ $? -ne 0 ]; then
        echo "    API validation FAILED: Could not fetch resource"
        return 1
    fi

    # Extract the value - handle both direct string and wrapper object formats
    local actual_value=$(echo "$response" | jq -r ".data.${expected_field} // .${expected_field}" 2>/dev/null)

    # Handle wrapper object format (e.g., {"_type":"...", "value":"..."})
    if echo "$actual_value" | jq -e '.value' > /dev/null 2>&1; then
        actual_value=$(echo "$actual_value" | jq -r '.value')
    fi

    if [ "$actual_value" = "$expected_value" ]; then
        echo "    API validation PASSED: $expected_field = '$expected_value'"
        return 0
    else
        echo "    API validation FAILED: Expected $expected_field='$expected_value', got '$actual_value'"
        return 1
    fi
}

PASSED=()
FAILED=()

#######################################
# Test 1: Label CRUD
#######################################
echo ""
echo "=========================================="
echo "CRUD Test: Label"
echo "=========================================="

test_path="$TEST_DIR/tests/09-label-crud"
cd "$test_path"
rm -f tfplan terraform.tfstate terraform.tfstate.backup

# Step 1: Create
echo "  [1/6] Creating label..."
if ! terraform plan -out=tfplan \
    -var="label_name=terraform-crud-label" \
    -var="label_description=Initial description" \
    -var="label_color=#FF0000" 2>&1; then
    echo "  FAILED: Plan failed"
    FAILED+=("09-label-crud (create plan)")
else
    if ! terraform apply -auto-approve tfplan 2>&1; then
        echo "  FAILED: Apply failed"
        FAILED+=("09-label-crud (create apply)")
    else
        LABEL_ID=$(terraform output -raw label_id)
        echo "  Created label ID: $LABEL_ID"

        # Step 2: Validate via API after create
        echo "  [2/6] Validating creation via API..."
        if validate_api "/label" "$LABEL_ID" "name" "terraform-crud-label"; then

            # Step 3: Update
            echo "  [3/6] Updating label..."
            if ! terraform plan -out=tfplan \
                -var="label_name=terraform-crud-label-updated" \
                -var="label_description=Updated description" \
                -var="label_color=#00FF00" 2>&1; then
                echo "  FAILED: Update plan failed"
                FAILED+=("09-label-crud (update plan)")
            else
                if ! terraform apply -auto-approve tfplan 2>&1; then
                    echo "  FAILED: Update apply failed"
                    FAILED+=("09-label-crud (update apply)")
                else
                    echo "  Label updated successfully"

                    # Step 4: Validate via API after update
                    echo "  [4/6] Validating update via API..."
                    if validate_api "/label" "$LABEL_ID" "name" "terraform-crud-label-updated"; then

                        # Step 5: Verify color was updated
                        echo "  [5/6] Validating color update via API..."
                        if validate_api "/label" "$LABEL_ID" "color" "#00FF00"; then
                            PASSED+=("09-label-crud")
                        else
                            FAILED+=("09-label-crud (color validation)")
                        fi
                    else
                        FAILED+=("09-label-crud (update validation)")
                    fi
                fi
            fi
        else
            FAILED+=("09-label-crud (create validation)")
        fi

        # Step 6: Destroy
        echo "  [6/6] Destroying label..."
        terraform destroy -auto-approve \
            -var="label_name=terraform-crud-label-updated" \
            -var="label_description=Updated description" \
            -var="label_color=#00FF00" 2>&1 || true
    fi
fi
rm -f tfplan terraform.tfstate terraform.tfstate.backup

#######################################
# Test 2: Monitor Status CRUD
#######################################
echo ""
echo "=========================================="
echo "CRUD Test: Monitor Status"
echo "=========================================="

test_path="$TEST_DIR/tests/10-monitor-status-crud"
cd "$test_path"
rm -f tfplan terraform.tfstate terraform.tfstate.backup

# Step 1: Create
echo "  [1/6] Creating monitor status..."
if ! terraform plan -out=tfplan \
    -var="status_name=terraform-crud-status" \
    -var="status_description=Initial status description" \
    -var="status_color=#00FF00" \
    -var="status_priority=100" 2>&1; then
    echo "  FAILED: Plan failed"
    FAILED+=("10-monitor-status-crud (create plan)")
else
    if ! terraform apply -auto-approve tfplan 2>&1; then
        echo "  FAILED: Apply failed"
        FAILED+=("10-monitor-status-crud (create apply)")
    else
        STATUS_ID=$(terraform output -raw monitor_status_id)
        echo "  Created monitor status ID: $STATUS_ID"

        # Step 2: Validate via API after create
        echo "  [2/6] Validating creation via API..."
        if validate_api "/monitor-status" "$STATUS_ID" "name" "terraform-crud-status"; then

            # Step 3: Update (note: priority cannot be updated per API restriction)
            echo "  [3/6] Updating monitor status..."
            if ! terraform plan -out=tfplan \
                -var="status_name=terraform-crud-status-updated" \
                -var="status_description=Updated status description" \
                -var="status_color=#0000FF" \
                -var="status_priority=100" 2>&1; then
                echo "  FAILED: Update plan failed"
                FAILED+=("10-monitor-status-crud (update plan)")
            else
                if ! terraform apply -auto-approve tfplan 2>&1; then
                    echo "  FAILED: Update apply failed"
                    FAILED+=("10-monitor-status-crud (update apply)")
                else
                    echo "  Monitor status updated successfully"

                    # Step 4: Validate via API after update
                    echo "  [4/6] Validating update via API..."
                    if validate_api "/monitor-status" "$STATUS_ID" "name" "terraform-crud-status-updated"; then

                        # Step 5: Verify color was updated
                        echo "  [5/6] Validating color update via API..."
                        if validate_api "/monitor-status" "$STATUS_ID" "color" "#0000FF"; then
                            PASSED+=("10-monitor-status-crud")
                        else
                            FAILED+=("10-monitor-status-crud (color validation)")
                        fi
                    else
                        FAILED+=("10-monitor-status-crud (update validation)")
                    fi
                fi
            fi
        else
            FAILED+=("10-monitor-status-crud (create validation)")
        fi

        # Step 6: Destroy
        echo "  [6/6] Destroying monitor status..."
        terraform destroy -auto-approve \
            -var="status_name=terraform-crud-status-updated" \
            -var="status_description=Updated status description" \
            -var="status_color=#0000FF" \
            -var="status_priority=100" 2>&1 || true
    fi
fi
rm -f tfplan terraform.tfstate terraform.tfstate.backup

#######################################
# Test 3: Incident Severity CRUD
#######################################
echo ""
echo "=========================================="
echo "CRUD Test: Incident Severity"
echo "=========================================="

test_path="$TEST_DIR/tests/11-incident-severity-crud"
cd "$test_path"
rm -f tfplan terraform.tfstate terraform.tfstate.backup

# Step 1: Create
echo "  [1/6] Creating incident severity..."
if ! terraform plan -out=tfplan \
    -var="severity_name=terraform-crud-severity" \
    -var="severity_description=Initial severity description" \
    -var="severity_color=#FFA500" \
    -var="severity_order=100" 2>&1; then
    echo "  FAILED: Plan failed"
    FAILED+=("11-incident-severity-crud (create plan)")
else
    if ! terraform apply -auto-approve tfplan 2>&1; then
        echo "  FAILED: Apply failed"
        FAILED+=("11-incident-severity-crud (create apply)")
    else
        SEVERITY_ID=$(terraform output -raw incident_severity_id)
        echo "  Created incident severity ID: $SEVERITY_ID"

        # Step 2: Validate via API after create
        echo "  [2/6] Validating creation via API..."
        if validate_api "/incident-severity" "$SEVERITY_ID" "name" "terraform-crud-severity"; then

            # Step 3: Update (note: order cannot be updated per API restriction)
            echo "  [3/6] Updating incident severity..."
            if ! terraform plan -out=tfplan \
                -var="severity_name=terraform-crud-severity-updated" \
                -var="severity_description=Updated severity description" \
                -var="severity_color=#FF00FF" \
                -var="severity_order=100" 2>&1; then
                echo "  FAILED: Update plan failed"
                FAILED+=("11-incident-severity-crud (update plan)")
            else
                if ! terraform apply -auto-approve tfplan 2>&1; then
                    echo "  FAILED: Update apply failed"
                    FAILED+=("11-incident-severity-crud (update apply)")
                else
                    echo "  Incident severity updated successfully"

                    # Step 4: Validate via API after update
                    echo "  [4/6] Validating update via API..."
                    if validate_api "/incident-severity" "$SEVERITY_ID" "name" "terraform-crud-severity-updated"; then

                        # Step 5: Verify color was updated
                        echo "  [5/6] Validating color update via API..."
                        if validate_api "/incident-severity" "$SEVERITY_ID" "color" "#FF00FF"; then
                            PASSED+=("11-incident-severity-crud")
                        else
                            FAILED+=("11-incident-severity-crud (color validation)")
                        fi
                    else
                        FAILED+=("11-incident-severity-crud (update validation)")
                    fi
                fi
            fi
        else
            FAILED+=("11-incident-severity-crud (create validation)")
        fi

        # Step 6: Destroy
        echo "  [6/6] Destroying incident severity..."
        terraform destroy -auto-approve \
            -var="severity_name=terraform-crud-severity-updated" \
            -var="severity_description=Updated severity description" \
            -var="severity_color=#FF00FF" \
            -var="severity_order=100" 2>&1 || true
    fi
fi
rm -f tfplan terraform.tfstate terraform.tfstate.backup

# Summary
echo ""
echo "=========================================="
echo "CRUD Test Summary"
echo "=========================================="
echo "Passed: ${#PASSED[@]}"
for t in "${PASSED[@]}"; do echo "  - $t"; done

if [ ${#FAILED[@]} -gt 0 ]; then
    echo "Failed: ${#FAILED[@]}"
    for t in "${FAILED[@]}"; do echo "  - $t"; done
    exit 1
fi

echo ""
echo "All CRUD tests passed!"
