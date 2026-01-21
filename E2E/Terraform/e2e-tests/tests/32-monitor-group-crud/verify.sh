#!/bin/bash
set -e

echo "=== Monitor Group CRUD Test Verification ==="

BASIC_ID=$(terraform output -raw basic_group_id 2>/dev/null || echo "")
LABELED_ID=$(terraform output -raw labeled_group_id 2>/dev/null || echo "")
SECONDARY_ID=$(terraform output -raw secondary_group_id 2>/dev/null || echo "")

echo "Basic Group ID: $BASIC_ID"
echo "Labeled Group ID: $LABELED_ID"
echo "Secondary Group ID: $SECONDARY_ID"

if [ -z "$BASIC_ID" ] || [ -z "$LABELED_ID" ] || [ -z "$SECONDARY_ID" ]; then
    echo "ERROR: One or more groups not created"
    exit 1
fi

echo ""
echo "=== Verifying idempotency ==="
PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT_CODE=$?
PLAN_EXIT_CODE=${PLAN_EXIT_CODE:-0}

if [ "$PLAN_EXIT_CODE" -eq 0 ]; then
    echo "SUCCESS: Idempotency test PASSED"
elif [ "$PLAN_EXIT_CODE" -eq 2 ]; then
    echo "ERROR: Changes detected"
    echo "$PLAN_OUTPUT"
    exit 1
else
    echo "ERROR: terraform plan failed"
    exit 1
fi

echo ""
echo "=== Monitor Group CRUD Test PASSED ==="
