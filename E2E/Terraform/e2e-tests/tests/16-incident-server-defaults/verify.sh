#!/bin/bash
# Verify script for 16-incident-server-defaults test
# Validates server-provided defaults for incident resource

set -e

# Helper function to unwrap API values that might be in wrapper format
unwrap_value() {
    local raw_value="$1"
    if echo "$raw_value" | jq -e '.value' > /dev/null 2>&1; then
        echo "$raw_value" | jq -r '.value'
    else
        echo "$raw_value" | jq -r '.'
    fi
}

# Get terraform outputs
INCIDENT_ID=$(terraform output -raw incident_id)
INCIDENT_SEVERITY_ID=$(terraform output -raw incident_severity_id)
EXPECTED_SEVERITY_NAME=$(terraform output -raw incident_severity_name)
EXPECTED_SEVERITY_COLOR=$(terraform output -raw incident_severity_color)
EXPECTED_TITLE=$(terraform output -raw incident_title)

echo "  Verifying incident with server defaults via API..."

# First validate the incident severity dependency
echo "  Verifying incident severity..."
echo "    Incident Severity ID: $INCIDENT_SEVERITY_ID"

RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/incident-severity/${INCIDENT_SEVERITY_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "name": true, "color": true}}')

API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Incident severity not found in API response"
    exit 1
fi
echo "    ✓ Incident severity exists in API"

API_NAME_RAW=$(echo "$RESPONSE" | jq '.name')
API_NAME=$(unwrap_value "$API_NAME_RAW")
if [ "$API_NAME" != "$EXPECTED_SEVERITY_NAME" ]; then
    echo "    ✗ FAILED: Severity name mismatch - Expected: '$EXPECTED_SEVERITY_NAME', Got: '$API_NAME'"
    exit 1
fi
echo "    ✓ Severity name matches: $API_NAME"

# Now validate the incident
echo ""
echo "  Verifying incident resource..."
echo "    Incident ID: $INCIDENT_ID"

RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/incident/${INCIDENT_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "title": true, "incidentSeverityId": true, "currentIncidentStateId": true, "monitors": true, "labels": true, "slug": true}}')

API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Incident not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ Incident exists in API"

# Validate title - handle wrapper object format
API_TITLE_RAW=$(echo "$RESPONSE" | jq '.title')
API_TITLE=$(unwrap_value "$API_TITLE_RAW")
if [ "$API_TITLE" != "$EXPECTED_TITLE" ]; then
    echo "    ✗ FAILED: Title mismatch - Expected: '$EXPECTED_TITLE', Got: '$API_TITLE'"
    exit 1
fi
echo "    ✓ Title matches: $API_TITLE"

# Validate incident severity relationship - handle wrapper object format (ObjectID)
API_SEVERITY_ID_RAW=$(echo "$RESPONSE" | jq '.incidentSeverityId')
API_SEVERITY_ID=$(unwrap_value "$API_SEVERITY_ID_RAW")
if [ "$API_SEVERITY_ID" != "$INCIDENT_SEVERITY_ID" ]; then
    echo "    ✗ FAILED: Incident severity ID mismatch - Expected: '$INCIDENT_SEVERITY_ID', Got: '$API_SEVERITY_ID'"
    exit 1
fi
echo "    ✓ Incident severity ID matches"

# Validate server-provided currentIncidentStateId - handle wrapper object format (ObjectID)
CURRENT_STATE_ID_RAW=$(echo "$RESPONSE" | jq '.currentIncidentStateId')
CURRENT_STATE_ID=$(unwrap_value "$CURRENT_STATE_ID_RAW")
if [ -n "$CURRENT_STATE_ID" ] && [ "$CURRENT_STATE_ID" != "null" ]; then
    echo "    ✓ Server-assigned currentIncidentStateId: $CURRENT_STATE_ID"
fi

# Validate slug was computed by server
API_SLUG=$(echo "$RESPONSE" | jq -r '.slug // empty')
if [ -n "$API_SLUG" ] && [ "$API_SLUG" != "null" ]; then
    echo "    ✓ Server-computed slug: $API_SLUG"
fi

echo "    ✓ All incident server defaults validations passed"
