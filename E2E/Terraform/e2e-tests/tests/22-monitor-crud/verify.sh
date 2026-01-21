#!/bin/bash
# Verify script for 22-monitor-crud test
# Validates that monitor CRUD operations work correctly

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Monitor CRUD Verification"

# Get terraform outputs
MANUAL_BASIC_ID=$(get_output manual_basic_id)
MANUAL_CUSTOM_ID=$(get_output manual_custom_id)
WITH_LABELS_ID=$(get_output with_labels_id)
LABEL_ID=$(get_output label_id)
MONITOR_SLUG=$(get_output monitor_slug)
MONITOR_STATUS_ID=$(get_output monitor_current_status_id)

echo "  Monitor IDs:"
echo "    Manual Basic: $MANUAL_BASIC_ID"
echo "    Manual Custom: $MANUAL_CUSTOM_ID"
echo "    With Labels: $WITH_LABELS_ID"
echo "    Label ID: $LABEL_ID"
echo "    Slug: $MONITOR_SLUG"
echo "    Status ID: $MONITOR_STATUS_ID"

# Verify all monitors were created
validation_failed=0

assert_not_empty "$MANUAL_BASIC_ID" "Manual Basic Monitor" || validation_failed=1
assert_not_empty "$MANUAL_CUSTOM_ID" "Manual Custom Monitor" || validation_failed=1
assert_not_empty "$WITH_LABELS_ID" "Monitor with Labels" || validation_failed=1
assert_not_empty "$LABEL_ID" "Label" || validation_failed=1

# Server-computed fields (warning only)
if [ -z "$MONITOR_SLUG" ]; then
    echo "    ⚠ WARNING: Monitor slug is empty - server may not have generated it"
fi

if [ $validation_failed -eq 1 ]; then
    print_failed "Monitor CRUD Verification"
fi

# Check idempotency (non-strict mode - some server defaults may cause changes)
check_idempotency false

print_passed "Monitor CRUD Verification"
