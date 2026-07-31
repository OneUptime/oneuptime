#!/bin/bash
set -e

echo "=== Monitor Steps Basic Test Verification ==="

# Get outputs
MANUAL_NO_STEPS_ID=$(terraform output -raw manual_no_steps_id 2>/dev/null || echo "")
MANUAL_WITH_DESCRIPTION_ID=$(terraform output -raw manual_with_description_id 2>/dev/null || echo "")
WITH_INTERVAL_ID=$(terraform output -raw with_interval_id 2>/dev/null || echo "")
DISABLED_ID=$(terraform output -raw disabled_id 2>/dev/null || echo "")
WITH_STEPS_ID=$(terraform output -raw with_steps_id 2>/dev/null || echo "")
WITH_STEPS_DESTINATION=$(terraform output -raw with_steps_destination 2>/dev/null || echo "")
MONITORING_INTERVAL=$(terraform output -raw with_interval_monitoring_interval 2>/dev/null || echo "")

echo "Manual No Steps ID: $MANUAL_NO_STEPS_ID"
echo "Manual With Description ID: $MANUAL_WITH_DESCRIPTION_ID"
echo "With Interval ID: $WITH_INTERVAL_ID"
echo "Disabled ID: $DISABLED_ID"
echo "With Steps ID: $WITH_STEPS_ID"
echo "With Steps Destination: $WITH_STEPS_DESTINATION"
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

if [ -z "$WITH_STEPS_ID" ]; then
    echo "ERROR: Monitor with typed monitor_steps was not created"
    exit 1
fi

if [ "$WITH_STEPS_DESTINATION" != "https://example.com" ]; then
    echo "ERROR: Typed monitor_steps destination mismatch. Expected 'https://example.com', got '$WITH_STEPS_DESTINATION'"
    exit 1
fi

# Verify the API stored the steps in the wire envelope format (the HCL is
# typed, but the API-side format is unchanged).
if [ -n "$ONEUPTIME_URL" ] && [ -n "$TF_VAR_api_key" ] && [ -n "$TF_VAR_project_id" ]; then
    RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/monitor/${WITH_STEPS_ID}/get-item" \
        -H "Content-Type: application/json" \
        -H "Apikey: $TF_VAR_api_key" \
        -H "projectid: $TF_VAR_project_id" \
        -d '{"select": {"_id": true, "monitorSteps": true}}')

    STEPS_TYPE=$(echo "$RESPONSE" | jq -r '.monitorSteps._type // empty')
    if [ "$STEPS_TYPE" != "MonitorSteps" ]; then
        echo "ERROR: API monitorSteps envelope missing. Response: $RESPONSE"
        exit 1
    fi

    API_DESTINATION=$(echo "$RESPONSE" | jq -r '.monitorSteps.value.monitorStepsInstanceArray[0].value.monitorDestination.value // empty')
    if [ "$API_DESTINATION" != "https://example.com" ]; then
        echo "ERROR: API monitorDestination mismatch. Expected 'https://example.com', got '$API_DESTINATION'"
        exit 1
    fi

    API_CHECK_ON=$(echo "$RESPONSE" | jq -r '.monitorSteps.value.monitorStepsInstanceArray[0].value.monitorCriteria.value.monitorCriteriaInstanceArray[0].value.filters[0].checkOn // empty')
    if [ "$API_CHECK_ON" != "Is Online" ]; then
        echo "ERROR: API filter checkOn mismatch. Expected 'Is Online', got '$API_CHECK_ON'"
        exit 1
    fi

    echo "API-side wire envelope validated (monitorDestination + filters)"
fi

echo ""
echo "=== Monitor Steps Basic Test PASSED ==="
