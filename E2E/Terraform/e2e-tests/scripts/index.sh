#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(cd "$TEST_DIR/../../.." && pwd)"

echo "=========================================="
echo "Terraform Provider E2E Tests"
echo "=========================================="
echo ""

# Cleanup function
cleanup() {
    echo ""
    echo "=== Running cleanup ==="
    "$SCRIPT_DIR/cleanup.sh" || true
    docker compose -f "$ROOT_DIR/docker-compose.yml" down -v || true
}

# Trap to ensure cleanup runs on exit
trap cleanup EXIT

# Step 2: Start OneUptime services
echo ""
echo "=== Step 2: Starting OneUptime Services ==="
npm run dev

# Step 3: Wait for services
echo ""
echo "=== Step 3: Waiting for services to be ready ==="
"$SCRIPT_DIR/wait-for-services.sh"

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

# Step 7: Run tests
echo ""
echo "=== Step 7: Running Terraform E2E Tests ==="
"$SCRIPT_DIR/run-tests.sh"

echo ""
echo "=========================================="
echo "E2E Tests Completed Successfully!"
echo "=========================================="
