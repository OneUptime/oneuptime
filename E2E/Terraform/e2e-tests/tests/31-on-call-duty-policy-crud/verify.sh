#!/bin/bash
set -e

echo "=== On-Call Duty Policy CRUD Test Verification ==="

BASIC_ID=$(terraform output -raw basic_policy_id 2>/dev/null || echo "")
REPEAT_ID=$(terraform output -raw repeat_policy_id 2>/dev/null || echo "")
LABELED_ID=$(terraform output -raw labeled_policy_id 2>/dev/null || echo "")

echo "Basic Policy ID: $BASIC_ID"
echo "Repeat Policy ID: $REPEAT_ID"
echo "Labeled Policy ID: $LABELED_ID"

if [ -z "$BASIC_ID" ] || [ -z "$REPEAT_ID" ] || [ -z "$LABELED_ID" ]; then
    echo "ERROR: One or more policies not created"
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
echo "=== On-Call Duty Policy CRUD Test PASSED ==="
