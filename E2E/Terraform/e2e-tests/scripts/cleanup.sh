#!/bin/bash

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"

source "$SCRIPT_DIR/lib.sh"

echo "=== Cleaning up ==="

# Remove Terraform state files
find "$TEST_DIR/tests" -name "*.tfstate*" -delete 2>/dev/null || true
find "$TEST_DIR/tests" -name ".terraform" -type d -exec rm -rf {} + 2>/dev/null || true
find "$TEST_DIR/tests" -name ".terraform.lock.hcl" -delete 2>/dev/null || true
find "$TEST_DIR/tests" -name "tfplan" -delete 2>/dev/null || true

# Remove test env file
rm -f "$TEST_DIR/test-env.sh"

# Restore the user's ~/.terraformrc (or remove the harness-generated one)
restore_terraformrc

# Remove local provider installation
rm -rf "$HOME/.terraform.d/plugins/registry.terraform.io/oneuptime" 2>/dev/null || true

echo "Cleanup complete"
