#!/bin/bash
# Verify script for 08-probe test
# Validates that the probe resource was created correctly via API
# Also validates GitHub Issue #2228: probe_version field consistency

set -e

# Get terraform outputs
RESOURCE_ID=$(terraform output -raw probe_id)
EXPECTED_KEY=$(terraform output -raw probe_key)
EXPECTED_NAME=$(terraform output -raw probe_name)
EXPECTED_VERSION=$(terraform output -raw probe_version)

echo "  Verifying probe resource via API..."
echo "    Resource ID: $RESOURCE_ID"

# Call API to get the resource
RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/probe/${RESOURCE_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "key": true, "name": true, "probeVersion": true}}')

# Check if response contains the resource
API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Probe not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ Probe exists in API"

# Validate key
API_KEY=$(echo "$RESPONSE" | jq -r '.key // empty')
if [ "$API_KEY" != "$EXPECTED_KEY" ]; then
    echo "    ✗ FAILED: Key mismatch - Expected: '$EXPECTED_KEY', Got: '$API_KEY'"
    exit 1
fi
echo "    ✓ Key matches: $API_KEY"

# Validate name
API_NAME=$(echo "$RESPONSE" | jq -r '.name // empty')
if [ "$API_NAME" != "$EXPECTED_NAME" ]; then
    echo "    ✗ FAILED: Name mismatch - Expected: '$EXPECTED_NAME', Got: '$API_NAME'"
    exit 1
fi
echo "    ✓ Name matches: $API_NAME"

# Validate probeVersion - handle wrapper object format {"_type":"Version","value":"1.0.0"}
API_VERSION_RAW=$(echo "$RESPONSE" | jq '.probeVersion')
if echo "$API_VERSION_RAW" | jq -e '.value' > /dev/null 2>&1; then
    API_VERSION=$(echo "$API_VERSION_RAW" | jq -r '.value')
else
    API_VERSION=$(echo "$API_VERSION_RAW" | jq -r '.')
fi

if [ "$API_VERSION" != "$EXPECTED_VERSION" ]; then
    echo "    ✗ FAILED: Probe version mismatch - Expected: '$EXPECTED_VERSION', Got: '$API_VERSION'"
    exit 1
fi
echo "    ✓ Probe version matches: $API_VERSION (Issue #2228 validated)"

echo "    ✓ All probe validations passed"
