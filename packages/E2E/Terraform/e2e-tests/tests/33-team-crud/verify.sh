#!/bin/bash
set -e

echo "=== Team CRUD Test Verification ==="

BASIC_ID=$(terraform output -raw basic_team_id 2>/dev/null || echo "")
DETAILED_ID=$(terraform output -raw detailed_team_id 2>/dev/null || echo "")
ENGINEERING_ID=$(terraform output -raw engineering_team_id 2>/dev/null || echo "")
OPERATIONS_ID=$(terraform output -raw operations_team_id 2>/dev/null || echo "")

echo "Basic Team ID: $BASIC_ID"
echo "Detailed Team ID: $DETAILED_ID"
echo "Engineering Team ID: $ENGINEERING_ID"
echo "Operations Team ID: $OPERATIONS_ID"

if [ -z "$BASIC_ID" ] || [ -z "$DETAILED_ID" ] || [ -z "$ENGINEERING_ID" ] || [ -z "$OPERATIONS_ID" ]; then
    echo "ERROR: One or more teams not created"
    exit 1
fi

echo ""
echo "=== Team CRUD Test PASSED ==="
