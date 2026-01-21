#!/bin/bash
set -e

echo "=== Incident CRUD Test Verification ==="

# Get outputs
BASIC_ID=$(terraform output -raw basic_incident_id 2>/dev/null || echo "")
ROOT_CAUSE_ID=$(terraform output -raw with_root_cause_id 2>/dev/null || echo "")
VISIBILITY_ID=$(terraform output -raw visibility_settings_id 2>/dev/null || echo "")
LABELED_ID=$(terraform output -raw with_labels_id 2>/dev/null || echo "")
SEVERITY_ID=$(terraform output -raw severity_id 2>/dev/null || echo "")
STATE_ID=$(terraform output -raw state_id 2>/dev/null || echo "")
ROOT_CAUSE=$(terraform output -raw with_root_cause_root_cause 2>/dev/null || echo "")

echo "Basic Incident ID: $BASIC_ID"
echo "Root Cause Incident ID: $ROOT_CAUSE_ID"
echo "Visibility Incident ID: $VISIBILITY_ID"
echo "Labeled Incident ID: $LABELED_ID"
echo "Severity ID: $SEVERITY_ID"
echo "State ID: $STATE_ID"
echo "Root Cause: $ROOT_CAUSE"

# Verify all resources created
if [ -z "$BASIC_ID" ]; then
    echo "ERROR: Basic incident not created"
    exit 1
fi

if [ -z "$ROOT_CAUSE_ID" ]; then
    echo "ERROR: Root cause incident not created"
    exit 1
fi

if [ -z "$VISIBILITY_ID" ]; then
    echo "ERROR: Visibility incident not created"
    exit 1
fi

if [ -z "$LABELED_ID" ]; then
    echo "ERROR: Labeled incident not created"
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

# Verify root cause is set correctly
if [ -z "$ROOT_CAUSE" ]; then
    echo "WARNING: Root cause is empty"
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
echo "=== Incident CRUD Test PASSED ==="
