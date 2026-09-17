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

# Restore a ~/.terraformrc backup left behind by an older run of the harness
restore_terraformrc

# Remove local provider installations. Both registry hosts are cleared because
# the install path is keyed by engine — Terraform runs install under
# registry.terraform.io, OpenTofu runs under registry.opentofu.org.
rm -rf "$HOME/.terraform.d/plugins/registry.terraform.io/oneuptime" 2>/dev/null || true
rm -rf "$HOME/.terraform.d/plugins/registry.opentofu.org/oneuptime" 2>/dev/null || true

# Remove the per-engine random-provider download caches
rm -rf /tmp/tf-random-provider-terraform /tmp/tf-random-provider-tofu 2>/dev/null || true

echo "Cleanup complete"
