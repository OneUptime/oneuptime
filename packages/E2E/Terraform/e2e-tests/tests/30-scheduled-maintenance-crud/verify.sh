#!/bin/bash
set -e

echo "=== Scheduled Maintenance CRUD Test Verification ==="

BASIC_ID=$(terraform output -raw basic_maintenance_id 2>/dev/null || echo "")
VISIBILITY_ID=$(terraform output -raw visibility_maintenance_id 2>/dev/null || echo "")
LABELED_ID=$(terraform output -raw labeled_maintenance_id 2>/dev/null || echo "")

echo "Basic Maintenance ID: $BASIC_ID"
echo "Visibility Maintenance ID: $VISIBILITY_ID"
echo "Labeled Maintenance ID: $LABELED_ID"

if [ -z "$BASIC_ID" ] || [ -z "$VISIBILITY_ID" ] || [ -z "$LABELED_ID" ]; then
    echo "ERROR: One or more maintenance events not created"
    exit 1
fi

echo ""
echo "=== Scheduled Maintenance CRUD Test PASSED ==="
