#!/bin/bash
# Verify script for 12-status-page-domain test
# Validates that domain, status page, and status page domain resources were created correctly via API

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
DOMAIN_ID=$(terraform output -raw domain_id)
STATUS_PAGE_ID=$(terraform output -raw status_page_id)
STATUS_PAGE_DOMAIN_ID=$(terraform output -raw status_page_domain_id)
EXPECTED_SUBDOMAIN=$(terraform output -raw subdomain)
EXPECTED_FULL_DOMAIN=$(terraform output -raw full_domain)
EXPECTED_DOMAIN_NAME=$(terraform output -raw domain_name)
EXPECTED_IS_VERIFIED=$(terraform output -raw domain_is_verified)
EXPECTED_SP_NAME=$(terraform output -raw status_page_name)
EXPECTED_SP_DESCRIPTION=$(terraform output -raw status_page_description)

echo "  Verifying domain resource via API..."
echo "    Domain ID: $DOMAIN_ID"

# Validate Domain
RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/domain/${DOMAIN_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "domain": true, "isVerified": true}}')

API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Domain not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ Domain exists in API"

API_DOMAIN_RAW=$(echo "$RESPONSE" | jq '.domain')
API_DOMAIN=$(unwrap_value "$API_DOMAIN_RAW")
if [ "$API_DOMAIN" != "$EXPECTED_DOMAIN_NAME" ]; then
    echo "    ✗ FAILED: Domain name mismatch - Expected: '$EXPECTED_DOMAIN_NAME', Got: '$API_DOMAIN'"
    exit 1
fi
echo "    ✓ Domain name matches: $API_DOMAIN"

API_IS_VERIFIED=$(echo "$RESPONSE" | jq -r '.isVerified // empty')
if [ "$API_IS_VERIFIED" != "$EXPECTED_IS_VERIFIED" ]; then
    echo "    ✗ FAILED: isVerified mismatch - Expected: '$EXPECTED_IS_VERIFIED', Got: '$API_IS_VERIFIED'"
    exit 1
fi
echo "    ✓ isVerified matches: $API_IS_VERIFIED"

# Validate Status Page
echo ""
echo "  Verifying status page resource via API..."
echo "    Status Page ID: $STATUS_PAGE_ID"

RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/status-page/${STATUS_PAGE_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "name": true, "description": true}}')

API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Status page not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ Status page exists in API"

API_NAME_RAW=$(echo "$RESPONSE" | jq '.name')
API_NAME=$(unwrap_value "$API_NAME_RAW")
if [ "$API_NAME" != "$EXPECTED_SP_NAME" ]; then
    echo "    ✗ FAILED: Name mismatch - Expected: '$EXPECTED_SP_NAME', Got: '$API_NAME'"
    exit 1
fi
echo "    ✓ Name matches: $API_NAME"

# Validate Status Page Domain
echo ""
echo "  Verifying status page domain resource via API..."
echo "    Status Page Domain ID: $STATUS_PAGE_DOMAIN_ID"

RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/status-page-domain/${STATUS_PAGE_DOMAIN_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "subdomain": true, "fullDomain": true}}')

API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Status page domain not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ Status page domain exists in API"

API_SUBDOMAIN_RAW=$(echo "$RESPONSE" | jq '.subdomain')
API_SUBDOMAIN=$(unwrap_value "$API_SUBDOMAIN_RAW")
if [ "$API_SUBDOMAIN" != "$EXPECTED_SUBDOMAIN" ]; then
    echo "    ✗ FAILED: Subdomain mismatch - Expected: '$EXPECTED_SUBDOMAIN', Got: '$API_SUBDOMAIN'"
    exit 1
fi
echo "    ✓ Subdomain matches: $API_SUBDOMAIN"

API_FULL_DOMAIN_RAW=$(echo "$RESPONSE" | jq '.fullDomain')
API_FULL_DOMAIN=$(unwrap_value "$API_FULL_DOMAIN_RAW")
if [ "$API_FULL_DOMAIN" != "$EXPECTED_FULL_DOMAIN" ]; then
    echo "    ✗ FAILED: Full domain mismatch - Expected: '$EXPECTED_FULL_DOMAIN', Got: '$API_FULL_DOMAIN'"
    exit 1
fi
echo "    ✓ Full domain matches: $API_FULL_DOMAIN"

echo "    ✓ All status page domain validations passed"
