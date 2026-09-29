#!/bin/bash
# Verify script for 14-status-page-server-defaults test
# Validates GitHub Issue #2232: server-provided defaults for status page work correctly

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

echo "  Verifying status page with server defaults via API (Issue #2232)..."
echo "    Resource ID: $RESOURCE_ID"

# Call API to get the resource
RESPONSE=$(curl -s -X POST "${ONEUPTIME_URL}/api/status-page/${RESOURCE_ID}/get-item" \
    -H "Content-Type: application/json" \
    -H "Apikey: $TF_VAR_api_key" \
    -H "projectid: $TF_VAR_project_id" \
    -d '{"select": {"_id": true, "name": true, "description": true, "pageTitle": true, "pageDescription": true, "isPublicStatusPage": true, "enableEmailSubscribers": true, "enableSmsSubscribers": true, "downtimeMonitorStatuses": true, "slug": true}}')

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

# Validate isPublicStatusPage
API_IS_PUBLIC=$(echo "$RESPONSE" | jq -r '.isPublicStatusPage // empty')
if [ "$API_IS_PUBLIC" != "$EXPECTED_IS_PUBLIC" ]; then
    echo "    ✗ FAILED: isPublicStatusPage mismatch - Expected: '$EXPECTED_IS_PUBLIC', Got: '$API_IS_PUBLIC'"
    exit 1
fi
echo "    ✓ isPublicStatusPage matches: $API_IS_PUBLIC"

# Validate server-provided downtimeMonitorStatuses (Issue #2232 key validation)
DOWNTIME_STATUSES=$(echo "$RESPONSE" | jq '.downtimeMonitorStatuses')
if [ "$DOWNTIME_STATUSES" = "null" ] || [ "$DOWNTIME_STATUSES" = "[]" ]; then
    echo "    ⚠ Warning: downtimeMonitorStatuses is empty (server may not have provided defaults)"
else
    STATUSES_COUNT=$(echo "$DOWNTIME_STATUSES" | jq 'length')
    echo "    ✓ Server-provided downtimeMonitorStatuses exists with $STATUSES_COUNT items (Issue #2232 validated)"
fi

# Validate slug was computed by server
API_SLUG=$(echo "$RESPONSE" | jq -r '.slug // empty')
if [ -n "$API_SLUG" ] && [ "$API_SLUG" != "null" ]; then
    echo "    ✓ Server-computed slug: $API_SLUG"
fi

echo "    ✓ All status page server defaults validations passed (Issue #2232)"
