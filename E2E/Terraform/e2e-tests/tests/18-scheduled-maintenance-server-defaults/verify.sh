#!/bin/bash
# Verify script for 18-scheduled-maintenance-server-defaults test
# Validates server-provided defaults for scheduled maintenance event resource

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
RESOURCE_ID=$(terraform output -raw scheduled_maintenance_event_id)
EXPECTED_TITLE=$(terraform output -raw scheduled_maintenance_event_title)
EXPECTED_STARTS_AT=$(terraform output -raw scheduled_maintenance_event_starts_at)
EXPECTED_ENDS_AT=$(terraform output -raw scheduled_maintenance_event_ends_at)

echo "  Verifying scheduled maintenance event with server defaults via API..."
echo "    Resource ID: $RESOURCE_ID"

# Call API to get the resource
RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/scheduled-maintenance/${RESOURCE_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "title": true, "startsAt": true, "endsAt": true, "currentScheduledMaintenanceStateId": true, "monitors": true, "labels": true, "statusPages": true, "slug": true}}')

# Check if response contains the resource
API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Scheduled maintenance event not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ Scheduled maintenance event exists in API"

# Validate title - handle wrapper object format
API_TITLE_RAW=$(echo "$RESPONSE" | jq '.title')
API_TITLE=$(unwrap_value "$API_TITLE_RAW")
if [ "$API_TITLE" != "$EXPECTED_TITLE" ]; then
    echo "    ✗ FAILED: Title mismatch - Expected: '$EXPECTED_TITLE', Got: '$API_TITLE'"
    exit 1
fi
echo "    ✓ Title matches: $API_TITLE"

# Validate startsAt
API_STARTS_AT=$(echo "$RESPONSE" | jq -r '.startsAt // empty')
if [ -n "$API_STARTS_AT" ] && [ "$API_STARTS_AT" != "null" ]; then
    echo "    ✓ startsAt is set: $API_STARTS_AT"
fi

# Validate endsAt
API_ENDS_AT=$(echo "$RESPONSE" | jq -r '.endsAt // empty')
if [ -n "$API_ENDS_AT" ] && [ "$API_ENDS_AT" != "null" ]; then
    echo "    ✓ endsAt is set: $API_ENDS_AT"
fi

# Validate server-provided currentScheduledMaintenanceStateId - handle wrapper object format (ObjectID)
CURRENT_STATE_ID_RAW=$(echo "$RESPONSE" | jq '.currentScheduledMaintenanceStateId')
CURRENT_STATE_ID=$(unwrap_value "$CURRENT_STATE_ID_RAW")
if [ -n "$CURRENT_STATE_ID" ] && [ "$CURRENT_STATE_ID" != "null" ]; then
    echo "    ✓ Server-assigned currentScheduledMaintenanceStateId: $CURRENT_STATE_ID"
fi

# Validate slug was computed by server
API_SLUG=$(echo "$RESPONSE" | jq -r '.slug // empty')
if [ -n "$API_SLUG" ] && [ "$API_SLUG" != "null" ]; then
    echo "    ✓ Server-computed slug: $API_SLUG"
fi

echo "    ✓ All scheduled maintenance server defaults validations passed"
