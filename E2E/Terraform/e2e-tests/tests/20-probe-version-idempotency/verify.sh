#!/bin/bash
# Verify script for 20-probe-version-idempotency test
#
# This test validates the probe_version READ idempotency issue:
# Bug: After CREATE, the READ operation returns wrapped format {"_type":"Version","value":"1.0.0"}
#      instead of unwrapping it to "1.0.0", causing state drift.
#
# Test approach:
# 1. Check the probe_version in Terraform state (should be "1.0.0")
# 2. Run terraform plan to check for drift (should show no changes)
# 3. Verify via API that the data is consistent

set -e

echo "  Testing probe_version idempotency (READ operation unwrapping)..."

# Get terraform outputs
RESOURCE_ID=$(terraform output -raw probe_id)
EXPECTED_VERSION=$(terraform output -raw probe_version)

echo "    Resource ID: $RESOURCE_ID"
echo "    Expected probe_version: $EXPECTED_VERSION"

# Step 1: Validate that probe_version in state is clean (not wrapped JSON)
if [[ "$EXPECTED_VERSION" == *"_type"* ]] || [[ "$EXPECTED_VERSION" == *'"value"'* ]]; then
    echo "    ✗ FAILED: probe_version in state is wrapped JSON: $EXPECTED_VERSION"
    echo "    Expected clean version string like '1.0.0'"
    exit 1
fi
echo "    ✓ probe_version in state is clean: $EXPECTED_VERSION"

# Step 2: Run terraform plan and check for drift
# This is the critical test - if READ doesn't unwrap properly, plan will show drift
echo "    Running terraform plan to check for drift..."
PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT_CODE=$?

# Exit code 0 = no changes (success)
# Exit code 1 = error
# Exit code 2 = changes detected (drift)
if [ "${PLAN_EXIT_CODE:-0}" -eq 2 ]; then
    echo "    ✗ FAILED: Terraform plan detected drift!"
    echo "    This indicates the READ operation is not properly unwrapping the probe_version"
    echo "    Plan output:"
    echo "$PLAN_OUTPUT"
    exit 1
elif [ "${PLAN_EXIT_CODE:-0}" -eq 1 ]; then
    echo "    ✗ FAILED: Terraform plan error"
    echo "$PLAN_OUTPUT"
    exit 1
fi
echo "    ✓ Terraform plan shows no changes (idempotent)"

# Step 3: Verify via API that probe_version matches
echo "    Verifying probe_version via API..."
RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/probe/${RESOURCE_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "probeVersion": true}}')

# Check if response contains the resource
API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Probe not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi

# Extract probe version - handle wrapper object format
API_VERSION_RAW=$(echo "$RESPONSE" | jq '.probeVersion')
if echo "$API_VERSION_RAW" | jq -e '.value' > /dev/null 2>&1; then
    API_VERSION=$(echo "$API_VERSION_RAW" | jq -r '.value')
    echo "    Note: API returns wrapped format: $API_VERSION_RAW"
    echo "    Provider should unwrap to: $API_VERSION"
else
    API_VERSION=$(echo "$API_VERSION_RAW" | jq -r '.')
fi

if [ "$API_VERSION" != "$EXPECTED_VERSION" ]; then
    echo "    ✗ FAILED: Probe version mismatch"
    echo "    Terraform state: $EXPECTED_VERSION"
    echo "    API (unwrapped): $API_VERSION"
    exit 1
fi
echo "    ✓ probe_version matches: $API_VERSION"

echo "    ✓ All probe_version idempotency tests passed"
echo "    The READ operation correctly unwraps Version wrapper objects"
