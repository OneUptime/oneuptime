#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(cd "$TEST_DIR/../../.." && pwd)"

echo "=========================================="
echo "Terraform Provider E2E Tests"
echo "=========================================="
echo ""

# Step 1: Install dependencies
#
# Dependencies are installed and the Terraform provider is generated BEFORE the
# OneUptime services stack is started. Generating the provider loads the entire
# codebase through ts-node (to build the OpenAPI spec) and then shells out to the
# Go toolchain to compile the provider, both of which are very memory hungry. If
# the full docker compose stack is already running at that point, the combined
# memory usage exhausts the CI runner and the job dies with "The runner has
# received a shutdown signal". Doing dependency install + generation first keeps
# those two memory peaks from overlapping with the running services.
echo ""
echo "=== Step 1: Installing dependencies ==="
cd "$ROOT_DIR"

# Clean node_modules to avoid permission issues with npm cache in CI
rm -rf Common/node_modules Scripts/node_modules || true

npm install
cd Common && npm install && cd ..
cd Scripts && npm install && cd ..

# Step 2: Generate Terraform Provider (before services start, see note above)
echo ""
echo "=== Step 2: Generating Terraform Provider ==="
cd "$ROOT_DIR"
npm run generate-terraform-provider

# Step 3: Start OneUptime services
echo ""
echo "=== Step 3: Starting OneUptime Services ==="
cd "$ROOT_DIR"
npm run dev

# Step 4: Wait for services
echo ""
echo "=== Step 4: Waiting for services to be ready ==="
cd "$ROOT_DIR"
npm run status-check

# Step 5: Setup test account
echo ""
echo "=== Step 5: Setting up test account ==="
cd "$TEST_DIR"
"$SCRIPT_DIR/setup-test-account.sh"

# Step 6: Run E2E tests (includes standard tests and CRUD tests with API validation)
echo ""
echo "=== Step 6: Running Terraform E2E Tests ==="
"$SCRIPT_DIR/run-tests.sh"

echo ""
echo "=========================================="
echo "E2E Tests Completed Successfully!"
echo "=========================================="
