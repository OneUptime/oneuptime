#!/bin/bash
set -e

echo "=== Monitor Types Test Verification ==="

# Get outputs
MANUAL_ID=$(terraform output -raw manual_id 2>/dev/null || echo "")
MANUAL_TYPE=$(terraform output -raw manual_type 2>/dev/null || echo "")
INCOMING_ID=$(terraform output -raw incoming_request_id 2>/dev/null || echo "")
INCOMING_TYPE=$(terraform output -raw incoming_request_type 2>/dev/null || echo "")
SERVER_ID=$(terraform output -raw server_id 2>/dev/null || echo "")
SERVER_TYPE=$(terraform output -raw server_type 2>/dev/null || echo "")
MANUAL_2_ID=$(terraform output -raw manual_2_id 2>/dev/null || echo "")
MANUAL_3_ID=$(terraform output -raw manual_3_id 2>/dev/null || echo "")

echo "Manual Monitor ID: $MANUAL_ID (type: $MANUAL_TYPE)"
echo "IncomingRequest Monitor ID: $INCOMING_ID (type: $INCOMING_TYPE)"
echo "Server Monitor ID: $SERVER_ID (type: $SERVER_TYPE)"
echo "Manual 2 ID: $MANUAL_2_ID"
echo "Manual 3 ID: $MANUAL_3_ID"

# Verify all monitors created
if [ -z "$MANUAL_ID" ]; then
    echo "ERROR: Manual monitor not created"
    exit 1
fi

if [ -z "$INCOMING_ID" ]; then
    echo "ERROR: IncomingRequest monitor not created"
    exit 1
fi

if [ -z "$SERVER_ID" ]; then
    echo "ERROR: Server monitor not created"
    exit 1
fi

# Verify monitor types are correct
if [ "$MANUAL_TYPE" != "Manual" ]; then
    echo "ERROR: Manual monitor type mismatch. Expected 'Manual', got '$MANUAL_TYPE'"
    exit 1
fi

if [ "$INCOMING_TYPE" != "IncomingRequest" ]; then
    echo "ERROR: IncomingRequest monitor type mismatch. Expected 'IncomingRequest', got '$INCOMING_TYPE'"
    exit 1
fi

if [ "$SERVER_TYPE" != "Server" ]; then
    echo "ERROR: Server monitor type mismatch. Expected 'Server', got '$SERVER_TYPE'"
    exit 1
fi

# Verify multiple monitors have unique IDs
if [ "$MANUAL_ID" = "$MANUAL_2_ID" ] || [ "$MANUAL_ID" = "$MANUAL_3_ID" ] || [ "$MANUAL_2_ID" = "$MANUAL_3_ID" ]; then
    echo "ERROR: Multiple monitors have duplicate IDs"
    exit 1
fi

echo ""
echo "=== Verifying idempotency ==="
PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT_CODE=$?
PLAN_EXIT_CODE=${PLAN_EXIT_CODE:-0}

if [ "$PLAN_EXIT_CODE" -eq 0 ]; then
    echo "SUCCESS: No changes detected - idempotency test PASSED"
elif [ "$PLAN_EXIT_CODE" -eq 2 ]; then
    echo "ERROR: Changes detected after apply"
    echo "Plan output:"
    echo "$PLAN_OUTPUT"
    exit 1
else
    echo "ERROR: terraform plan failed"
    exit 1
fi

echo ""
echo "=== Monitor Types Test PASSED ==="
