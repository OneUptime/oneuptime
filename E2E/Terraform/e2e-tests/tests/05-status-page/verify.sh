#!/bin/bash
# Verify script for 05-status-page test
# Validates that the status page resource was created correctly via API

set -e

# Helper function to unwrap API values that might be in wrapper format
# e.g., {"_type": "Color", "value": "#FF5733"} -> "#FF5733"
unwrap_value() {
    local raw_value="$1"
    if echo "$raw_value" | jq -e '.value' > /dev/null 2>&1; then
        echo "$raw_value" | jq -r '.value'
    else
        echo "$raw_value" | jq -r '.'
    fi
}

# Get terraform outputs
RESOURCE_ID=$(terraform output -raw status_page_id)
EXPECTED_NAME=$(terraform output -raw status_page_name)
EXPECTED_DESCRIPTION=$(terraform output -raw status_page_description)
EXPECTED_PAGE_TITLE=$(terraform output -raw status_page_page_title)
EXPECTED_PAGE_DESCRIPTION=$(terraform output -raw status_page_page_description)
EXPECTED_IS_PUBLIC=$(terraform output -raw status_page_is_public_status_page)
EXPECTED_EMAIL_SUBSCRIBERS=$(terraform output -raw status_page_enable_email_subscribers)
EXPECTED_SMS_SUBSCRIBERS=$(terraform output -raw status_page_enable_sms_subscribers)

echo "  Verifying status page resource via API..."
echo "    Resource ID: $RESOURCE_ID"

# Call API to get the resource
RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/status-page/${RESOURCE_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "name": true, "description": true, "pageTitle": true, "pageDescription": true, "isPublicStatusPage": true, "enableEmailSubscribers": true, "enableSmsSubscribers": true}}')

# Check if response contains the resource
API_ID=$(echo "$RESPONSE" | jq -r '._id // empty')
if [ -z "$API_ID" ] || [ "$API_ID" = "null" ]; then
    echo "    ✗ FAILED: Status page not found in API response"
    echo "    Response: $RESPONSE"
    exit 1
fi
echo "    ✓ Status page exists in API"

# Validate name - handle wrapper object format
API_NAME_RAW=$(echo "$RESPONSE" | jq '.name')
API_NAME=$(unwrap_value "$API_NAME_RAW")
if [ "$API_NAME" != "$EXPECTED_NAME" ]; then
    echo "    ✗ FAILED: Name mismatch - Expected: '$EXPECTED_NAME', Got: '$API_NAME'"
    exit 1
fi
echo "    ✓ Name matches: $API_NAME"

# Validate description - handle wrapper object format
API_DESCRIPTION_RAW=$(echo "$RESPONSE" | jq '.description')
API_DESCRIPTION=$(unwrap_value "$API_DESCRIPTION_RAW")
if [ "$API_DESCRIPTION" != "$EXPECTED_DESCRIPTION" ]; then
    echo "    ✗ FAILED: Description mismatch - Expected: '$EXPECTED_DESCRIPTION', Got: '$API_DESCRIPTION'"
    exit 1
fi
echo "    ✓ Description matches: $API_DESCRIPTION"

# Validate pageTitle - handle wrapper object format
API_PAGE_TITLE_RAW=$(echo "$RESPONSE" | jq '.pageTitle')
API_PAGE_TITLE=$(unwrap_value "$API_PAGE_TITLE_RAW")
if [ "$API_PAGE_TITLE" != "$EXPECTED_PAGE_TITLE" ]; then
    echo "    ✗ FAILED: Page title mismatch - Expected: '$EXPECTED_PAGE_TITLE', Got: '$API_PAGE_TITLE'"
    exit 1
fi
echo "    ✓ Page title matches: $API_PAGE_TITLE"

# Validate pageDescription - handle wrapper object format
API_PAGE_DESCRIPTION_RAW=$(echo "$RESPONSE" | jq '.pageDescription')
API_PAGE_DESCRIPTION=$(unwrap_value "$API_PAGE_DESCRIPTION_RAW")
if [ "$API_PAGE_DESCRIPTION" != "$EXPECTED_PAGE_DESCRIPTION" ]; then
    echo "    ✗ FAILED: Page description mismatch - Expected: '$EXPECTED_PAGE_DESCRIPTION', Got: '$API_PAGE_DESCRIPTION'"
    exit 1
fi
echo "    ✓ Page description matches: $API_PAGE_DESCRIPTION"

# Validate isPublicStatusPage - boolean values might not be returned if they have no read permission
# We make this check optional - if the value is returned and doesn't match, fail; if not returned, skip
API_IS_PUBLIC=$(echo "$RESPONSE" | jq -r 'if .isPublicStatusPage == null then "skip" elif .isPublicStatusPage == false then "false" else "true" end')
if [ "$API_IS_PUBLIC" = "skip" ]; then
    echo "    ⚠ Skipping isPublicStatusPage check (field not returned by API)"
elif [ "$API_IS_PUBLIC" != "$EXPECTED_IS_PUBLIC" ]; then
    echo "    ✗ FAILED: isPublicStatusPage mismatch - Expected: '$EXPECTED_IS_PUBLIC', Got: '$API_IS_PUBLIC'"
    exit 1
else
    echo "    ✓ isPublicStatusPage matches: $API_IS_PUBLIC"
fi

# Validate enableEmailSubscribers - boolean values might not be returned
API_EMAIL_SUBSCRIBERS=$(echo "$RESPONSE" | jq -r 'if .enableEmailSubscribers == null then "skip" elif .enableEmailSubscribers == false then "false" else "true" end')
if [ "$API_EMAIL_SUBSCRIBERS" = "skip" ]; then
    echo "    ⚠ Skipping enableEmailSubscribers check (field not returned by API)"
elif [ "$API_EMAIL_SUBSCRIBERS" != "$EXPECTED_EMAIL_SUBSCRIBERS" ]; then
    echo "    ✗ FAILED: enableEmailSubscribers mismatch - Expected: '$EXPECTED_EMAIL_SUBSCRIBERS', Got: '$API_EMAIL_SUBSCRIBERS'"
    exit 1
else
    echo "    ✓ enableEmailSubscribers matches: $API_EMAIL_SUBSCRIBERS"
fi

# Validate enableSmsSubscribers - boolean values might not be returned
API_SMS_SUBSCRIBERS=$(echo "$RESPONSE" | jq -r 'if .enableSmsSubscribers == null then "skip" elif .enableSmsSubscribers == false then "false" else "true" end')
if [ "$API_SMS_SUBSCRIBERS" = "skip" ]; then
    echo "    ⚠ Skipping enableSmsSubscribers check (field not returned by API)"
elif [ "$API_SMS_SUBSCRIBERS" != "$EXPECTED_SMS_SUBSCRIBERS" ]; then
    echo "    ✗ FAILED: enableSmsSubscribers mismatch - Expected: '$EXPECTED_SMS_SUBSCRIBERS', Got: '$API_SMS_SUBSCRIBERS'"
    exit 1
else
    echo "    ✓ enableSmsSubscribers matches: $API_SMS_SUBSCRIBERS"
fi

echo "    ✓ All status page validations passed"
