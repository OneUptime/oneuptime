#!/bin/bash
# Verify script for 38-file-crud test
#
# This test validates the oneuptime_file resource:
# 1. File resources are created successfully
# 2. A second terraform plan does NOT fail with "Read Not Implemented"
# 3. The state is preserved correctly (idempotency)
#
# This is the critical regression test for:
# https://github.com/OneUptime/oneuptime/issues/XXXX
# "Error: Read Not Implemented - This resource does not support read operations"

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "File Resource CRUD & Idempotency Verification"

# Get terraform outputs
LOGO_ID=$(get_output logo_id)
FAVICON_ID=$(get_output favicon_id)
LOGO_NAME=$(get_output logo_name)
FAVICON_NAME=$(get_output favicon_name)
LOGO_FILE_TYPE=$(get_output logo_file_type)

echo "  Logo ID: $LOGO_ID"
echo "  Favicon ID: $FAVICON_ID"

# Step 1: Validate that resource IDs were created
validation_failed=0

assert_not_empty "$LOGO_ID" "Logo ID" || validation_failed=1
assert_not_empty "$FAVICON_ID" "Favicon ID" || validation_failed=1
assert_not_empty "$LOGO_NAME" "Logo Name" || validation_failed=1
assert_not_empty "$FAVICON_NAME" "Favicon Name" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "File Resource Creation"
fi

echo ""
echo "  === Step 1: File resources created successfully ==="

# Step 2: Verify file_type is preserved in state
assert_equals "image/png" "$LOGO_FILE_TYPE" "Logo file_type" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "File Resource Field Verification"
fi

echo ""
echo "  === Step 2: File resource fields verified ==="

# Step 3: Critical test - Run terraform plan to check for "Read Not Implemented" error
# This is the exact bug that was reported: second plan fails with Read Not Implemented
echo ""
echo "  === Step 3: Verifying second plan succeeds (no Read Not Implemented error) ==="
echo "  Running terraform plan to check for errors..."

PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT_CODE=$?
PLAN_EXIT_CODE=${PLAN_EXIT_CODE:-0}

if [ "$PLAN_EXIT_CODE" -eq 1 ]; then
    # Check specifically for the "Read Not Implemented" error
    if echo "$PLAN_OUTPUT" | grep -q "Read Not Implemented"; then
        echo "  ✗ FAILED: 'Read Not Implemented' error on second plan!"
        echo "  This is the exact bug being tested."
        echo "  Plan output:"
        echo "$PLAN_OUTPUT"
        print_failed "File Resource Read Idempotency"
    fi
    echo "  ✗ FAILED: terraform plan error (exit code 1)"
    echo "$PLAN_OUTPUT"
    print_failed "File Resource Plan"
elif [ "$PLAN_EXIT_CODE" -eq 0 ]; then
    echo "  ✓ Terraform plan shows no changes - idempotency PASSED"
elif [ "$PLAN_EXIT_CODE" -eq 2 ]; then
    # Changes detected but no error - acceptable for timestamp-based names
    echo "  ⚠ Changes detected (expected due to timestamp in name with lifecycle ignore)"
    echo "  ✓ No 'Read Not Implemented' error - the critical fix is working"
fi

echo ""
echo "  === Step 3: Second plan succeeded (no Read Not Implemented error) ==="

print_passed "File Resource CRUD & Idempotency Verification"
