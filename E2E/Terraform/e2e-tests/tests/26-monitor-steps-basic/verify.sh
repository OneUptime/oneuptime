#!/bin/bash
set -e

echo "=== Monitor Steps Basic Test Verification ==="

# Get outputs
MANUAL_NO_STEPS_ID=$(terraform output -raw manual_no_steps_id 2>/dev/null || echo "")
MANUAL_WITH_DESCRIPTION_ID=$(terraform output -raw manual_with_description_id 2>/dev/null || echo "")
WITH_INTERVAL_ID=$(terraform output -raw with_interval_id 2>/dev/null || echo "")
DISABLED_ID=$(terraform output -raw disabled_id 2>/dev/null || echo "")
MONITOR_STEPS=$(terraform output -raw manual_no_steps_monitor_steps 2>/dev/null || echo "")
MONITORING_INTERVAL=$(terraform output -raw with_interval_monitoring_interval 2>/dev/null || echo "")

echo "Manual No Steps ID: $MANUAL_NO_STEPS_ID"
echo "Manual With Description ID: $MANUAL_WITH_DESCRIPTION_ID"
echo "With Interval ID: $WITH_INTERVAL_ID"
echo "Disabled ID: $DISABLED_ID"
echo "Monitor Steps (first 100 chars): ${MONITOR_STEPS:0:100}..."
echo "Monitoring Interval: $MONITORING_INTERVAL"

# Verify all monitors were created
if [ -z "$MANUAL_NO_STEPS_ID" ]; then
    echo "ERROR: Manual no steps monitor was not created"
    exit 1
fi

if [ -z "$MANUAL_WITH_DESCRIPTION_ID" ]; then
    echo "ERROR: Manual with description monitor was not created"
    exit 1
fi

if [ -z "$WITH_INTERVAL_ID" ]; then
    echo "ERROR: Monitor with interval was not created"
    exit 1
fi

if [ -z "$DISABLED_ID" ]; then
    echo "ERROR: Disabled monitor was not created"
    exit 1
fi

echo ""
echo "=== Verifying idempotency (critical for monitor_steps) ==="
PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT_CODE=$?
PLAN_EXIT_CODE=${PLAN_EXIT_CODE:-0}

if [ "$PLAN_EXIT_CODE" -eq 0 ]; then
    echo "SUCCESS: No changes detected - monitor_steps idempotency test PASSED"
elif [ "$PLAN_EXIT_CODE" -eq 2 ]; then
    echo "ERROR: Changes detected after apply - monitor_steps causing drift"
    echo "This indicates server defaults in monitor_steps are not being handled correctly"
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
echo "=== Monitor Steps Basic Test PASSED ==="
