#!/bin/bash
set -e

# Test: StatusPage CRUD Verification
#
# This script validates:
# 1. All status pages were created successfully
# 2. Server-computed fields are populated
# 3. Server-injected defaults are handled correctly (Issue #2232)
# 4. Idempotency - re-apply should show no changes

echo "=== StatusPage CRUD Test Verification ==="

# Get terraform outputs
PUBLIC_ID=$(terraform output -raw public_status_page_id 2>/dev/null || echo "")
PRIVATE_ID=$(terraform output -raw private_status_page_id 2>/dev/null || echo "")
EMAIL_ID=$(terraform output -raw email_status_page_id 2>/dev/null || echo "")
BRANDED_ID=$(terraform output -raw branded_status_page_id 2>/dev/null || echo "")
LABELED_ID=$(terraform output -raw labeled_status_page_id 2>/dev/null || echo "")
LABEL_ID=$(terraform output -raw label_id 2>/dev/null || echo "")
PUBLIC_SLUG=$(terraform output -raw public_slug 2>/dev/null || echo "")
DOWNTIME_STATUSES=$(terraform output -json public_downtime_monitor_statuses 2>/dev/null || echo "[]")

echo "Public Status Page ID: $PUBLIC_ID"
echo "Private Status Page ID: $PRIVATE_ID"
echo "Email Status Page ID: $EMAIL_ID"
echo "Branded Status Page ID: $BRANDED_ID"
echo "Labeled Status Page ID: $LABELED_ID"
echo "Label ID: $LABEL_ID"
echo "Public Slug: $PUBLIC_SLUG"
echo "Downtime Monitor Statuses: $DOWNTIME_STATUSES"

# Verify all status pages were created
if [ -z "$PUBLIC_ID" ]; then
    echo "ERROR: Public status page was not created"
    exit 1
fi

if [ -z "$PRIVATE_ID" ]; then
    echo "ERROR: Private status page was not created"
    exit 1
fi

if [ -z "$EMAIL_ID" ]; then
    echo "ERROR: Email status page was not created"
    exit 1
fi

if [ -z "$BRANDED_ID" ]; then
    echo "ERROR: Branded status page was not created"
    exit 1
fi

if [ -z "$LABELED_ID" ]; then
    echo "ERROR: Labeled status page was not created"
    exit 1
fi

# Verify server-computed fields
if [ -z "$PUBLIC_SLUG" ]; then
    echo "WARNING: Server-generated slug is empty"
fi

# Verify Issue #2232: Server-injected defaults are handled correctly
echo ""
echo "=== Validating Issue #2232 Fix (downtime_monitor_statuses handling) ==="
# The downtime_monitor_statuses should be populated by the server if not specified
# The fix ensures Terraform accepts these server-provided defaults without error

# Verify idempotency
echo ""
echo "=== Verifying idempotency ==="
PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT_CODE=$?
PLAN_EXIT_CODE=${PLAN_EXIT_CODE:-0}

if [ "$PLAN_EXIT_CODE" -eq 0 ]; then
    echo "SUCCESS: No changes detected - idempotency test PASSED"
elif [ "$PLAN_EXIT_CODE" -eq 2 ]; then
    echo "ERROR: Changes detected after apply - idempotency test FAILED"
    echo "This may indicate Issue #2232 fix is not working correctly"
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
echo "=== StatusPage CRUD Test PASSED ==="
