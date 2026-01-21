#!/bin/bash
set -e

# Test: Probe CRUD Verification
#
# This script validates:
# 1. All probes were created successfully
# 2. probe_version is stored as a simple string, not JSON object (Issue #2228 fix)
# 3. Idempotency - re-apply should show no changes

echo "=== Probe CRUD Test Verification ==="

# Get terraform outputs
BASIC_PROBE_ID=$(terraform output -raw basic_probe_id 2>/dev/null || echo "")
BASIC_PROBE_VERSION=$(terraform output -raw basic_probe_version 2>/dev/null || echo "")
VERSIONED_PROBE_ID=$(terraform output -raw versioned_probe_id 2>/dev/null || echo "")
VERSIONED_PROBE_VERSION=$(terraform output -raw versioned_probe_version 2>/dev/null || echo "")
AUTO_ENABLE_PROBE_ID=$(terraform output -raw auto_enable_probe_id 2>/dev/null || echo "")
LABELED_PROBE_ID=$(terraform output -raw labeled_probe_id 2>/dev/null || echo "")
LABEL_ID=$(terraform output -raw label_id 2>/dev/null || echo "")

echo "Basic Probe ID: $BASIC_PROBE_ID"
echo "Basic Probe Version: $BASIC_PROBE_VERSION"
echo "Versioned Probe ID: $VERSIONED_PROBE_ID"
echo "Versioned Probe Version: $VERSIONED_PROBE_VERSION"
echo "Auto-Enable Probe ID: $AUTO_ENABLE_PROBE_ID"
echo "Labeled Probe ID: $LABELED_PROBE_ID"
echo "Label ID: $LABEL_ID"

# Verify all probes were created
if [ -z "$BASIC_PROBE_ID" ]; then
    echo "ERROR: Basic probe was not created"
    exit 1
fi

if [ -z "$VERSIONED_PROBE_ID" ]; then
    echo "ERROR: Versioned probe was not created"
    exit 1
fi

if [ -z "$AUTO_ENABLE_PROBE_ID" ]; then
    echo "ERROR: Auto-enable probe was not created"
    exit 1
fi

if [ -z "$LABELED_PROBE_ID" ]; then
    echo "ERROR: Labeled probe was not created"
    exit 1
fi

# Verify probe_version is NOT in JSON format (Issue #2228 fix validation)
# The version should be "1.0.0" not '{"_type":"Version","value":"1.0.0"}'
echo ""
echo "=== Validating Issue #2228 Fix (probe_version format) ==="

if [[ "$BASIC_PROBE_VERSION" == *"_type"* ]] || [[ "$BASIC_PROBE_VERSION" == *"{"* ]]; then
    echo "ERROR: probe_version is in JSON format instead of string"
    echo "Expected: '1.0.0'"
    echo "Got: '$BASIC_PROBE_VERSION'"
    echo "Issue #2228 fix is NOT working correctly"
    exit 1
fi

if [ "$BASIC_PROBE_VERSION" != "1.0.0" ]; then
    echo "WARNING: probe_version is not '1.0.0'"
    echo "Got: '$BASIC_PROBE_VERSION'"
    # Don't fail as the version might be normalized differently
fi

if [[ "$VERSIONED_PROBE_VERSION" == *"_type"* ]] || [[ "$VERSIONED_PROBE_VERSION" == *"{"* ]]; then
    echo "ERROR: versioned probe_version is in JSON format instead of string"
    echo "Expected: '2.1.0'"
    echo "Got: '$VERSIONED_PROBE_VERSION'"
    exit 1
fi

echo "SUCCESS: probe_version values are in correct string format"

# Verify idempotency
echo ""
echo "=== Verifying idempotency ==="
PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT_CODE=$?
PLAN_EXIT_CODE=${PLAN_EXIT_CODE:-0}

if [ "$PLAN_EXIT_CODE" -eq 0 ]; then
    echo "SUCCESS: No changes detected - idempotency test PASSED"
elif [ "$PLAN_EXIT_CODE" -eq 2 ]; then
    echo "ERROR: Changes detected after apply - idempotency test FAILED"
    echo "This may indicate Issue #2228 fix is not working correctly"
    echo ""
    echo "Plan output:"
    echo "$PLAN_OUTPUT"
    exit 1
else
    echo "ERROR: terraform plan failed with exit code $PLAN_EXIT_CODE"
    echo "$PLAN_OUTPUT"
    exit 1
fi

echo ""
echo "=== Probe CRUD Test PASSED ==="
