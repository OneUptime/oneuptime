#!/bin/bash
# Verify script for 01-label test
# Validates that the label resource was created correctly via API

set -e

# Get terraform outputs
LABEL_ID=$(terraform output -raw label_id)
LABEL_NAME=$(terraform output -raw label_name)
LABEL_DESCRIPTION=$(terraform output -raw label_description)
LABEL_COLOR=$(terraform output -raw label_color)

echo "  Verifying label resource via API..."
echo "    Label ID: $LABEL_ID"

# Call API to get the label
RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/label/${LABEL_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "name": true, "description": true, "color": true}}')

# Check if response contains the label
API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Label not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ Label exists in API"

# Validate name
API_NAME=$(echo "$RESPONSE" | jq -r '.name // empty')
if [ "$API_NAME" != "$LABEL_NAME" ]; then
    echo "    ✗ FAILED: Name mismatch - Expected: '$LABEL_NAME', Got: '$API_NAME'"
    exit 1
fi
echo "    ✓ Name matches: $API_NAME"

# Validate description
API_DESCRIPTION=$(echo "$RESPONSE" | jq -r '.description // empty')
if [ "$API_DESCRIPTION" != "$LABEL_DESCRIPTION" ]; then
    echo "    ✗ FAILED: Description mismatch - Expected: '$LABEL_DESCRIPTION', Got: '$API_DESCRIPTION'"
    exit 1
fi
echo "    ✓ Description matches: $API_DESCRIPTION"

# Validate color
API_COLOR=$(echo "$RESPONSE" | jq -r '.color // empty')
if [ "$API_COLOR" != "$LABEL_COLOR" ]; then
    echo "    ✗ FAILED: Color mismatch - Expected: '$LABEL_COLOR', Got: '$API_COLOR'"
    exit 1
fi
echo "    ✓ Color matches: $API_COLOR"

echo "    ✓ All label validations passed"
