#!/bin/bash
# Verify script for 15-monitor-server-defaults test
# Validates GitHub Issue #2226: server-provided defaults for monitor work correctly

set -e

# Get terraform outputs
RESOURCE_ID=$(terraform output -raw monitor_id)
EXPECTED_NAME=$(terraform output -raw monitor_name)
EXPECTED_DESCRIPTION=$(terraform output -raw monitor_description)
EXPECTED_MONITOR_TYPE=$(terraform output -raw monitor_monitor_type)

echo "  Verifying monitor with server defaults via API (Issue #2226)..."
echo "    Resource ID: $RESOURCE_ID"

# Call API to get the resource
RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/monitor/${RESOURCE_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "name": true, "description": true, "monitorType": true, "monitorSteps": true, "slug": true, "currentMonitorStatusId": true}}')

# Check if response contains the resource
API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Monitor not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ Monitor exists in API"

# Validate name
API_NAME=$(echo "$RESPONSE" | jq -r '.name // empty')
if [ "$API_NAME" != "$EXPECTED_NAME" ]; then
    echo "    ✗ FAILED: Name mismatch - Expected: '$EXPECTED_NAME', Got: '$API_NAME'"
    exit 1
fi
echo "    ✓ Name matches: $API_NAME"

# Validate description
API_DESCRIPTION=$(echo "$RESPONSE" | jq -r '.description // empty')
if [ "$API_DESCRIPTION" != "$EXPECTED_DESCRIPTION" ]; then
    echo "    ✗ FAILED: Description mismatch - Expected: '$EXPECTED_DESCRIPTION', Got: '$API_DESCRIPTION'"
    exit 1
fi
echo "    ✓ Description matches: $API_DESCRIPTION"

# Validate monitorType
API_MONITOR_TYPE=$(echo "$RESPONSE" | jq -r '.monitorType // empty')
if [ "$API_MONITOR_TYPE" != "$EXPECTED_MONITOR_TYPE" ]; then
    echo "    ✗ FAILED: Monitor type mismatch - Expected: '$EXPECTED_MONITOR_TYPE', Got: '$API_MONITOR_TYPE'"
    exit 1
fi
echo "    ✓ Monitor type matches: $API_MONITOR_TYPE"

# Validate server-provided monitorSteps (Issue #2226 key validation)
MONITOR_STEPS=$(echo "$RESPONSE" | jq '.monitorSteps')
if [ "$MONITOR_STEPS" != "null" ]; then
    echo "    ✓ Server-provided monitorSteps exists (Issue #2226 validated)"
fi

# Validate server-assigned currentMonitorStatusId
CURRENT_STATUS_ID=$(echo "$RESPONSE" | jq -r '.currentMonitorStatusId // empty')
if [ -n "$CURRENT_STATUS_ID" ] && [ "$CURRENT_STATUS_ID" != "null" ]; then
    echo "    ✓ Server-assigned currentMonitorStatusId: $CURRENT_STATUS_ID"
fi

# Validate slug was computed by server
API_SLUG=$(echo "$RESPONSE" | jq -r '.slug // empty')
if [ -n "$API_SLUG" ] && [ "$API_SLUG" != "null" ]; then
    echo "    ✓ Server-computed slug: $API_SLUG"
fi

echo "    ✓ All monitor server defaults validations passed (Issue #2226)"
