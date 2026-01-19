#!/bin/bash
# Verify script for 05-status-page test
# Validates that the status page resource was created correctly via API

set -e

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

# Validate pageTitle
API_PAGE_TITLE=$(echo "$RESPONSE" | jq -r '.pageTitle // empty')
if [ "$API_PAGE_TITLE" != "$EXPECTED_PAGE_TITLE" ]; then
    echo "    ✗ FAILED: Page title mismatch - Expected: '$EXPECTED_PAGE_TITLE', Got: '$API_PAGE_TITLE'"
    exit 1
fi
echo "    ✓ Page title matches: $API_PAGE_TITLE"

# Validate pageDescription
API_PAGE_DESCRIPTION=$(echo "$RESPONSE" | jq -r '.pageDescription // empty')
if [ "$API_PAGE_DESCRIPTION" != "$EXPECTED_PAGE_DESCRIPTION" ]; then
    echo "    ✗ FAILED: Page description mismatch - Expected: '$EXPECTED_PAGE_DESCRIPTION', Got: '$API_PAGE_DESCRIPTION'"
    exit 1
fi
echo "    ✓ Page description matches: $API_PAGE_DESCRIPTION"

# Validate isPublicStatusPage
API_IS_PUBLIC=$(echo "$RESPONSE" | jq -r '.isPublicStatusPage // empty')
if [ "$API_IS_PUBLIC" != "$EXPECTED_IS_PUBLIC" ]; then
    echo "    ✗ FAILED: isPublicStatusPage mismatch - Expected: '$EXPECTED_IS_PUBLIC', Got: '$API_IS_PUBLIC'"
    exit 1
fi
echo "    ✓ isPublicStatusPage matches: $API_IS_PUBLIC"

# Validate enableEmailSubscribers
API_EMAIL_SUBSCRIBERS=$(echo "$RESPONSE" | jq -r '.enableEmailSubscribers // empty')
if [ "$API_EMAIL_SUBSCRIBERS" != "$EXPECTED_EMAIL_SUBSCRIBERS" ]; then
    echo "    ✗ FAILED: enableEmailSubscribers mismatch - Expected: '$EXPECTED_EMAIL_SUBSCRIBERS', Got: '$API_EMAIL_SUBSCRIBERS'"
    exit 1
fi
echo "    ✓ enableEmailSubscribers matches: $API_EMAIL_SUBSCRIBERS"

# Validate enableSmsSubscribers
API_SMS_SUBSCRIBERS=$(echo "$RESPONSE" | jq -r '.enableSmsSubscribers // empty')
if [ "$API_SMS_SUBSCRIBERS" != "$EXPECTED_SMS_SUBSCRIBERS" ]; then
    echo "    ✗ FAILED: enableSmsSubscribers mismatch - Expected: '$EXPECTED_SMS_SUBSCRIBERS', Got: '$API_SMS_SUBSCRIBERS'"
    exit 1
fi
echo "    ✓ enableSmsSubscribers matches: $API_SMS_SUBSCRIBERS"

echo "    ✓ All status page validations passed"
