#!/bin/bash
# Verify script for 38-file-crud test
#
# This test validates the oneuptime_file resource:
# 1. File resources are created successfully
# 2. The state is preserved correctly across plans
#
# Historical regression context: a second plan used to fail with
# "Error: Read Not Implemented - This resource does not support read
# operations". The runner's drift gate now exercises the second plan; this
# script only performs state/output assertions.

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

print_passed "File Resource CRUD & Idempotency Verification"
