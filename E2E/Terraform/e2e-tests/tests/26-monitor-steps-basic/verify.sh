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
echo "=== Monitor Steps Basic Test PASSED ==="
