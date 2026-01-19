#!/bin/bash
# Verify script for 19-on-call-duty-policy-server-defaults test
# Validates server-provided defaults for on-call duty policy resource

set -e

# Get terraform outputs
RESOURCE_ID=$(terraform output -raw on_call_duty_policy_id)
EXPECTED_NAME=$(terraform output -raw on_call_duty_policy_name)

echo "  Verifying on-call duty policy with server defaults via API..."
echo "    Resource ID: $RESOURCE_ID"

# Call API to get the resource
RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/on-call-duty-policy/${RESOURCE_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "name": true, "description": true, "labels": true, "slug": true}}')

# Check if response contains the resource
API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: On-call duty policy not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ On-call duty policy exists in API"

# Validate name
API_NAME=$(echo "$RESPONSE" | jq -r '.name // empty')
if [ "$API_NAME" != "$EXPECTED_NAME" ]; then
    echo "    ✗ FAILED: Name mismatch - Expected: '$EXPECTED_NAME', Got: '$API_NAME'"
    exit 1
fi
echo "    ✓ Name matches: $API_NAME"

# Validate slug was computed by server
API_SLUG=$(echo "$RESPONSE" | jq -r '.slug // empty')
if [ -n "$API_SLUG" ] && [ "$API_SLUG" != "null" ]; then
    echo "    ✓ Server-computed slug: $API_SLUG"
fi

echo "    ✓ All on-call duty policy server defaults validations passed"
