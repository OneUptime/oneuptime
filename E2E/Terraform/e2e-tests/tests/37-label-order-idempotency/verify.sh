#!/bin/bash
# Verify script for 37-label-order-idempotency test
#
# This test validates that label arrays are order-independent and do not
# cause drift or "inconsistent result after apply" errors.

set -e

echo "  Testing label order idempotency (labels should be order-independent)..."

PROBE_ID=$(terraform output -raw probe_id)
LABEL_FIRST=$(terraform output -raw label_first_id)
LABEL_SECOND=$(terraform output -raw label_second_id)

echo "    Probe ID: $PROBE_ID"
echo "    Label IDs: $LABEL_FIRST, $LABEL_SECOND"

# Step 1: Validate labels contain both IDs in state output
LABELS_JSON=$(terraform output -json probe_labels)

if ! echo "$LABELS_JSON" | jq -e --arg id "$LABEL_FIRST" 'index($id) != null' > /dev/null; then
    echo "    ✗ FAILED: First label ID not found in probe labels state"
    echo "    Labels: $LABELS_JSON"
    exit 1
fi

if ! echo "$LABELS_JSON" | jq -e --arg id "$LABEL_SECOND" 'index($id) != null' > /dev/null; then
    echo "    ✗ FAILED: Second label ID not found in probe labels state"
    echo "    Labels: $LABELS_JSON"
    exit 1
fi

echo "    ✓ Probe labels contain both label IDs"

# Step 2: Run terraform plan and check for drift
echo "    Running terraform plan to check for drift..."
PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT_CODE=$?

# Exit code 0 = no changes (success)
# Exit code 1 = error
# Exit code 2 = changes detected (drift)
if [ "${PLAN_EXIT_CODE:-0}" -eq 2 ]; then
    echo "    ✗ FAILED: Terraform plan detected drift!"
    echo "    This indicates label order is not being normalized"
    echo "    Plan output:"
    echo "$PLAN_OUTPUT"
    exit 1
elif [ "${PLAN_EXIT_CODE:-0}" -eq 1 ]; then
    echo "    ✗ FAILED: Terraform plan error"
    echo "$PLAN_OUTPUT"
    exit 1
fi

echo "    ✓ Terraform plan shows no changes (idempotent)"

echo "    ✓ Label order idempotency tests passed"
