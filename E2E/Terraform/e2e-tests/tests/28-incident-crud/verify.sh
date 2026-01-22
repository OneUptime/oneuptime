#!/bin/bash
# Verify script for 28-incident-crud test
# Validates that incident CRUD operations work correctly

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Incident CRUD Verification"

# Get outputs
BASIC_ID=$(get_output basic_incident_id)
ROOT_CAUSE_ID=$(get_output with_root_cause_id)
VISIBILITY_ID=$(get_output visibility_settings_id)
LABELED_ID=$(get_output with_labels_id)
SEVERITY_ID=$(get_output severity_id)
STATE_ID=$(get_output state_id)
ROOT_CAUSE=$(get_output with_root_cause_root_cause)

echo "  Incident IDs:"
echo "    Basic: $BASIC_ID"
echo "    Root Cause: $ROOT_CAUSE_ID"
echo "    Visibility: $VISIBILITY_ID"
echo "    Labeled: $LABELED_ID"
echo "    Severity ID: $SEVERITY_ID"
echo "    State ID: $STATE_ID"
echo "    Root Cause Value: $ROOT_CAUSE"

# Verify all resources created
validation_failed=0

assert_not_empty "$BASIC_ID" "Basic Incident" || validation_failed=1
assert_not_empty "$ROOT_CAUSE_ID" "Root Cause Incident" || validation_failed=1
assert_not_empty "$VISIBILITY_ID" "Visibility Incident" || validation_failed=1
assert_not_empty "$LABELED_ID" "Labeled Incident" || validation_failed=1
assert_not_empty "$SEVERITY_ID" "Severity" || validation_failed=1
assert_not_empty "$STATE_ID" "State" || validation_failed=1

# Root cause (warning only)
if [ -z "$ROOT_CAUSE" ]; then
    echo "    ⚠ WARNING: Root cause is empty"
fi

if [ $validation_failed -eq 1 ]; then
    print_failed "Incident CRUD Verification"
fi

# Check idempotency (strict mode - incident should be fully idempotent)
check_idempotency true

print_passed "Incident CRUD Verification"
