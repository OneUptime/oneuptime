#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(cd "$TEST_DIR/../../.." && pwd)"

echo "=========================================="
echo "Terraform Provider E2E Tests"
echo "=========================================="
echo ""


# Step 2: Start OneUptime services
echo ""
echo "=== Step 2: Starting OneUptime Services ==="
npm run dev

# Step 3: Wait for services
echo ""
echo "=== Step 3: Waiting for services to be ready ==="
cd "$ROOT_DIR"
npm run status-check

# Step 4: Install dependencies
echo ""
echo "=== Step 4: Installing dependencies ==="
cd "$ROOT_DIR"
npm install
cd Common && npm install && cd ..
cd Scripts && npm install && cd ..

# Step 5: Generate Terraform Provider
echo ""
echo "=== Step 5: Generating Terraform Provider ==="
npm run generate-terraform-provider

# Step 6: Setup test account
echo ""
echo "=== Step 6: Setting up test account ==="
cd "$TEST_DIR"
"$SCRIPT_DIR/setup-test-account.sh"

# Step 7: Run basic tests
echo ""
echo "=== Step 7: Running Terraform E2E Tests ==="
"$SCRIPT_DIR/run-tests.sh"

# Step 8: Run CRUD tests (create, update, API validation, destroy)
echo ""
echo "=== Step 8: Running Terraform CRUD Tests ==="
"$SCRIPT_DIR/run-crud-tests.sh"

echo ""
echo "=========================================="
echo "E2E Tests Completed Successfully!"
echo "=========================================="
