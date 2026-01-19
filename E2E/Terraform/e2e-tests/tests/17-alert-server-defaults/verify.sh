#!/bin/bash
# Verify script for 17-alert-server-defaults test
# Validates server-provided defaults for alert resource

set -e

# Get terraform outputs
ALERT_ID=$(terraform output -raw alert_id)
ALERT_SEVERITY_ID=$(terraform output -raw alert_severity_id)
EXPECTED_SEVERITY_NAME=$(terraform output -raw alert_severity_name)
EXPECTED_SEVERITY_COLOR=$(terraform output -raw alert_severity_color)
EXPECTED_TITLE=$(terraform output -raw alert_title)

echo "  Verifying alert with server defaults via API..."

# First validate the alert severity dependency
echo "  Verifying alert severity..."
echo "    Alert Severity ID: $ALERT_SEVERITY_ID"

RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/alert-severity/${ALERT_SEVERITY_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "name": true, "color": true}}')

API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Alert severity not found in API response"
    exit 1
fi
echo "    ✓ Alert severity exists in API"

API_NAME=$(echo "$RESPONSE" | jq -r '.name // empty')
if [ "$API_NAME" != "$EXPECTED_SEVERITY_NAME" ]; then
    echo "    ✗ FAILED: Severity name mismatch - Expected: '$EXPECTED_SEVERITY_NAME', Got: '$API_NAME'"
    exit 1
fi
echo "    ✓ Severity name matches: $API_NAME"

# Now validate the alert
echo ""
echo "  Verifying alert resource..."
echo "    Alert ID: $ALERT_ID"

RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/alert/${ALERT_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "title": true, "alertSeverityId": true, "currentAlertStateId": true, "labels": true}}')

API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Alert not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ Alert exists in API"

# Validate title
API_TITLE=$(echo "$RESPONSE" | jq -r '.title // empty')
if [ "$API_TITLE" != "$EXPECTED_TITLE" ]; then
    echo "    ✗ FAILED: Title mismatch - Expected: '$EXPECTED_TITLE', Got: '$API_TITLE'"
    exit 1
fi
echo "    ✓ Title matches: $API_TITLE"

# Validate alert severity relationship
API_SEVERITY_ID=$(echo "$RESPONSE" | jq -r '.alertSeverityId // empty')
if [ "$API_SEVERITY_ID" != "$ALERT_SEVERITY_ID" ]; then
    echo "    ✗ FAILED: Alert severity ID mismatch - Expected: '$ALERT_SEVERITY_ID', Got: '$API_SEVERITY_ID'"
    exit 1
fi
echo "    ✓ Alert severity ID matches"

# Validate server-provided currentAlertStateId
CURRENT_STATE_ID=$(echo "$RESPONSE" | jq -r '.currentAlertStateId // empty')
if [ -n "$CURRENT_STATE_ID" ] && [ "$CURRENT_STATE_ID" != "null" ]; then
    echo "    ✓ Server-assigned currentAlertStateId: $CURRENT_STATE_ID"
fi

echo "    ✓ All alert server defaults validations passed"
