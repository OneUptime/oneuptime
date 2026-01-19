#!/bin/bash
# Verify script for 11-incident-severity-crud test
# Validates that the incident severity CRUD operations work correctly via API

set -e

# Get terraform outputs
RESOURCE_ID=$(terraform output -raw incident_severity_id)
EXPECTED_NAME=$(terraform output -raw incident_severity_name)
EXPECTED_DESCRIPTION=$(terraform output -raw incident_severity_description)
EXPECTED_COLOR=$(terraform output -raw incident_severity_color)
EXPECTED_ORDER=$(terraform output -raw incident_severity_order)

echo "  Verifying incident severity CRUD resource via API..."
echo "    Resource ID: $RESOURCE_ID"

# Call API to get the resource
RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/incident-severity/${RESOURCE_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "name": true, "description": true, "color": true, "order": true}}')

# Check if response contains the resource
API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Incident severity not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ Incident severity exists in API"

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

# Validate color
API_COLOR=$(echo "$RESPONSE" | jq -r '.color // empty')
if [ "$API_COLOR" != "$EXPECTED_COLOR" ]; then
    echo "    ✗ FAILED: Color mismatch - Expected: '$EXPECTED_COLOR', Got: '$API_COLOR'"
    exit 1
fi
echo "    ✓ Color matches: $API_COLOR"

# Validate order
API_ORDER=$(echo "$RESPONSE" | jq -r '.order // empty')
if [ "$API_ORDER" != "$EXPECTED_ORDER" ]; then
    echo "    ✗ FAILED: Order mismatch - Expected: '$EXPECTED_ORDER', Got: '$API_ORDER'"
    exit 1
fi
echo "    ✓ Order matches: $API_ORDER"

echo "    ✓ All incident severity CRUD validations passed"
