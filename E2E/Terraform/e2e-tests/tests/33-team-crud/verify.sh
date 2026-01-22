#!/bin/bash
set -e

echo "=== Team CRUD Test Verification ==="

BASIC_ID=$(terraform output -raw basic_team_id 2>/dev/null || echo "")
DETAILED_ID=$(terraform output -raw detailed_team_id 2>/dev/null || echo "")
ENGINEERING_ID=$(terraform output -raw engineering_team_id 2>/dev/null || echo "")
OPERATIONS_ID=$(terraform output -raw operations_team_id 2>/dev/null || echo "")

echo "Basic Team ID: $BASIC_ID"
echo "Detailed Team ID: $DETAILED_ID"
echo "Engineering Team ID: $ENGINEERING_ID"
echo "Operations Team ID: $OPERATIONS_ID"

if [ -z "$BASIC_ID" ] || [ -z "$DETAILED_ID" ] || [ -z "$ENGINEERING_ID" ] || [ -z "$OPERATIONS_ID" ]; then
    echo "ERROR: One or more teams not created"
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
echo "=== Team CRUD Test PASSED ==="
