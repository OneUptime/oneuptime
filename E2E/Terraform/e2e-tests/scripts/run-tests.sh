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

# Test directories in order
TEST_DIRS=(
    "01-label"
    "02-monitor-status"
    "03-incident-severity"
    "04-incident-state"
    "05-status-page"
    "06-alert-severity"
    "07-alert-state"
)

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

    # Skip terraform init when using dev_overrides (it will fail trying to query registry)
    # The provider is loaded directly from the dev_overrides path

    # Plan
    echo "  [1/3] Planning..."
    if ! terraform plan -out=tfplan 2>&1; then
        echo "  FAILED: Plan failed"
        FAILED+=("$test_name")
        continue
    fi

    # Apply
    echo "  [2/3] Applying..."
    if ! terraform apply -auto-approve tfplan 2>&1; then
        echo "  FAILED: Apply failed"
        FAILED+=("$test_name")
        # Try to cleanup anyway
        terraform destroy -auto-approve 2>&1 || true
        continue
    fi

    # Show outputs
    echo "  Outputs:"
    terraform output 2>&1 || true

    # Destroy
    echo "  [3/3] Destroying..."
    if ! terraform destroy -auto-approve 2>&1; then
        echo "  WARNING: Destroy failed"
        FAILED+=("$test_name (destroy)")
    fi

    # Cleanup state files
    rm -f tfplan terraform.tfstate terraform.tfstate.backup

    echo "  PASSED: $test_name"
    PASSED+=("$test_name")
done

# Summary
echo ""
echo "=========================================="
echo "Test Summary"
echo "=========================================="
echo "Passed: ${#PASSED[@]}"
for t in "${PASSED[@]}"; do echo "  - $t"; done

if [ ${#FAILED[@]} -gt 0 ]; then
    echo "Failed: ${#FAILED[@]}"
    for t in "${FAILED[@]}"; do echo "  - $t"; done
    exit 1
fi

echo ""
echo "All tests passed!"
