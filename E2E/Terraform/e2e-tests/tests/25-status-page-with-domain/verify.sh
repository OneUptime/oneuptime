#!/bin/bash
set -e

# Test: StatusPage with Domain Integration Verification
#
# This script validates the complete integration of StatusPage and StatusPageDomain:
# 1. All resources were created successfully
# 2. Computed fields are populated correctly (Issue #2236)
# 3. Server-injected defaults are handled correctly (Issue #2232)
# 4. Idempotency - re-apply should show no changes

echo "=== StatusPage with Domain Integration Test Verification ==="

# Get terraform outputs for domains
PRIMARY_DOMAIN_ID=$(terraform output -raw primary_domain_id 2>/dev/null || echo "")
SECONDARY_DOMAIN_ID=$(terraform output -raw secondary_domain_id 2>/dev/null || echo "")

# Get terraform outputs for status pages
MAIN_STATUS_PAGE_ID=$(terraform output -raw main_status_page_id 2>/dev/null || echo "")
SECONDARY_STATUS_PAGE_ID=$(terraform output -raw secondary_status_page_id 2>/dev/null || echo "")

# Get terraform outputs for status page domains
PRIMARY_MAIN_DOMAIN_ID=$(terraform output -raw primary_main_domain_id 2>/dev/null || echo "")
SECONDARY_MAIN_DOMAIN_ID=$(terraform output -raw secondary_main_domain_id 2>/dev/null || echo "")
PRIMARY_SECONDARY_DOMAIN_ID=$(terraform output -raw primary_secondary_domain_id 2>/dev/null || echo "")

# Get computed fields (Issue #2236)
PRIMARY_MAIN_FULL_DOMAIN=$(terraform output -raw primary_main_full_domain 2>/dev/null || echo "")
SECONDARY_MAIN_FULL_DOMAIN=$(terraform output -raw secondary_main_full_domain 2>/dev/null || echo "")
PRIMARY_SECONDARY_FULL_DOMAIN=$(terraform output -raw primary_secondary_full_domain 2>/dev/null || echo "")

# Get server-injected defaults (Issue #2232)
MAIN_SLUG=$(terraform output -raw main_slug 2>/dev/null || echo "")
DOWNTIME_STATUSES=$(terraform output -json main_downtime_monitor_statuses 2>/dev/null || echo "[]")

echo "=== Domain Resources ==="
echo "Primary Domain ID: $PRIMARY_DOMAIN_ID"
echo "Secondary Domain ID: $SECONDARY_DOMAIN_ID"

echo ""
echo "=== Status Page Resources ==="
echo "Main Status Page ID: $MAIN_STATUS_PAGE_ID"
echo "Secondary Status Page ID: $SECONDARY_STATUS_PAGE_ID"

echo ""
echo "=== Status Page Domain Resources ==="
echo "Primary-Main Domain ID: $PRIMARY_MAIN_DOMAIN_ID"
echo "Secondary-Main Domain ID: $SECONDARY_MAIN_DOMAIN_ID"
echo "Primary-Secondary Domain ID: $PRIMARY_SECONDARY_DOMAIN_ID"

echo ""
echo "=== Computed Fields (Issue #2236) ==="
echo "Primary-Main Full Domain: $PRIMARY_MAIN_FULL_DOMAIN"
echo "Secondary-Main Full Domain: $SECONDARY_MAIN_FULL_DOMAIN"
echo "Primary-Secondary Full Domain: $PRIMARY_SECONDARY_FULL_DOMAIN"

echo ""
echo "=== Server-Injected Defaults (Issue #2232) ==="
echo "Main Slug: $MAIN_SLUG"
echo "Downtime Monitor Statuses: $DOWNTIME_STATUSES"

# Verify all domains were created
if [ -z "$PRIMARY_DOMAIN_ID" ] || [ -z "$SECONDARY_DOMAIN_ID" ]; then
    echo "ERROR: One or more domains were not created"
    exit 1
fi

# Verify all status pages were created
if [ -z "$MAIN_STATUS_PAGE_ID" ] || [ -z "$SECONDARY_STATUS_PAGE_ID" ]; then
    echo "ERROR: One or more status pages were not created"
    exit 1
fi

# Verify all status page domains were created
if [ -z "$PRIMARY_MAIN_DOMAIN_ID" ] || [ -z "$SECONDARY_MAIN_DOMAIN_ID" ] || [ -z "$PRIMARY_SECONDARY_DOMAIN_ID" ]; then
    echo "ERROR: One or more status page domains were not created"
    exit 1
fi

# Validate Issue #2236 Fix: Computed fields should be populated
echo ""
echo "=== Validating Issue #2236 Fix ==="
if [ -z "$PRIMARY_MAIN_FULL_DOMAIN" ]; then
    echo "ERROR: primary_main full_domain is empty - computed field not populated"
    exit 1
fi

if [ -z "$SECONDARY_MAIN_FULL_DOMAIN" ]; then
    echo "ERROR: secondary_main full_domain is empty - computed field not populated"
    exit 1
fi

if [ -z "$PRIMARY_SECONDARY_FULL_DOMAIN" ]; then
    echo "ERROR: primary_secondary full_domain is empty - computed field not populated"
    exit 1
fi

echo "SUCCESS: All computed full_domain fields are populated"

# Validate Issue #2232 Fix: Server-injected defaults should not cause drift
echo ""
echo "=== Validating Issue #2232 Fix ==="
if [ -z "$MAIN_SLUG" ]; then
    echo "WARNING: Server-generated slug is empty"
fi

# Verify idempotency (most critical test)
echo ""
echo "=== Verifying idempotency ==="
PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT_CODE=$?
PLAN_EXIT_CODE=${PLAN_EXIT_CODE:-0}

if [ "$PLAN_EXIT_CODE" -eq 0 ]; then
    echo "SUCCESS: No changes detected - idempotency test PASSED"
    echo "Both Issue #2236 and Issue #2232 fixes are working correctly"
elif [ "$PLAN_EXIT_CODE" -eq 2 ]; then
    echo "ERROR: Changes detected after apply - idempotency test FAILED"
    echo "This indicates Issue #2236 or Issue #2232 fixes may not be working correctly"
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
echo "=== StatusPage with Domain Integration Test PASSED ==="
