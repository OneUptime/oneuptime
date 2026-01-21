#!/bin/bash
set -e

echo "=== Alert CRUD Test Verification ==="

# Get outputs
BASIC_ID=$(terraform output -raw basic_alert_id 2>/dev/null || echo "")
ROOT_CAUSE_ID=$(terraform output -raw root_cause_alert_id 2>/dev/null || echo "")
LABELED_ID=$(terraform output -raw labeled_alert_id 2>/dev/null || echo "")
SEVERITY_ID=$(terraform output -raw severity_id 2>/dev/null || echo "")
STATE_ID=$(terraform output -raw state_id 2>/dev/null || echo "")
MONITOR_ID=$(terraform output -raw monitor_id 2>/dev/null || echo "")

echo "Basic Alert ID: $BASIC_ID"
echo "Root Cause Alert ID: $ROOT_CAUSE_ID"
echo "Labeled Alert ID: $LABELED_ID"
echo "Severity ID: $SEVERITY_ID"
echo "State ID: $STATE_ID"
echo "Monitor ID: $MONITOR_ID"

# Verify all resources created
if [ -z "$BASIC_ID" ]; then
    echo "ERROR: Basic alert not created"
    exit 1
fi

if [ -z "$ROOT_CAUSE_ID" ]; then
    echo "ERROR: Root cause alert not created"
    exit 1
fi

if [ -z "$LABELED_ID" ]; then
    echo "ERROR: Labeled alert not created"
    exit 1
fi

if [ -z "$SEVERITY_ID" ]; then
    echo "ERROR: Severity not created"
    exit 1
fi

if [ -z "$STATE_ID" ]; then
    echo "ERROR: State not created"
    exit 1
fi

if [ -z "$MONITOR_ID" ]; then
    echo "ERROR: Monitor not created"
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
echo "=== Alert CRUD Test PASSED ==="
