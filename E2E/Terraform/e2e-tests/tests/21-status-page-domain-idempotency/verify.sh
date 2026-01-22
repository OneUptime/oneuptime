#!/bin/bash
set -e

# Test: StatusPageDomain Idempotency Verification (Issue #2236)
#
# This script validates:
# 1. The status_page_domain was created successfully
# 2. The computed field 'full_domain' is populated
# 3. Running terraform plan again shows NO changes (idempotency)

echo "=== StatusPageDomain Idempotency Test Verification ==="

# Get terraform outputs
STATUS_PAGE_DOMAIN_ID=$(terraform output -raw status_page_domain_id 2>/dev/null || echo "")
FULL_DOMAIN=$(terraform output -raw full_domain 2>/dev/null || echo "")
SUBDOMAIN=$(terraform output -raw subdomain 2>/dev/null || echo "")

echo "Status Page Domain ID: $STATUS_PAGE_DOMAIN_ID"
echo "Full Domain: $FULL_DOMAIN"
echo "Subdomain: $SUBDOMAIN"

# Verify status_page_domain_id is not empty
if [ -z "$STATUS_PAGE_DOMAIN_ID" ]; then
    echo "ERROR: status_page_domain_id is empty - resource was not created"
    exit 1
fi

# Verify full_domain is computed (not empty)
if [ -z "$FULL_DOMAIN" ]; then
    echo "ERROR: full_domain is empty - computed field was not populated"
    exit 1
fi

# Verify full_domain contains the subdomain
if [[ "$FULL_DOMAIN" != *"$SUBDOMAIN"* ]]; then
    echo "WARNING: full_domain '$FULL_DOMAIN' does not contain subdomain '$SUBDOMAIN'"
    # This is a warning, not an error - the server might format it differently
fi

# CRITICAL: Run terraform plan to verify idempotency
# After a successful apply, running plan again should show NO changes
echo ""
echo "=== Running terraform plan to verify idempotency ==="
PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT_CODE=$?
PLAN_EXIT_CODE=${PLAN_EXIT_CODE:-0}

# Exit codes:
# 0 - Success, no changes
# 1 - Error
# 2 - Success, changes present

if [ "$PLAN_EXIT_CODE" -eq 0 ]; then
    echo "SUCCESS: No changes detected - idempotency test PASSED"
elif [ "$PLAN_EXIT_CODE" -eq 2 ]; then
    echo "ERROR: Changes detected after apply - idempotency test FAILED"
    echo "This indicates the fix for issue #2236 may not be working correctly"
    echo ""
    echo "Plan output:"
    echo "$PLAN_OUTPUT"
    exit 1
else
    echo "ERROR: terraform plan failed with exit code $PLAN_EXIT_CODE"
    echo "$PLAN_OUTPUT"
    exit 1
fi

echo ""
echo "=== StatusPageDomain Idempotency Test PASSED ==="
