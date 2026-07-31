#!/bin/bash
# Verify script for 49-monitor-probe test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Monitor Probe Verification"

PROBE_ID=$(get_output probe_id)
MONITOR_ID=$(get_output monitor_id)
PAIRING_ID=$(get_output monitor_probe_id)

echo "  Verifying monitor-probe pairing via API..."
echo "    Probe ID: $PROBE_ID"
echo "    Monitor ID: $MONITOR_ID"
echo "    Pairing ID: $PAIRING_ID"

assert_not_empty "$PAIRING_ID" "Monitor probe id" || print_failed "Monitor Probe Verification"

if ! verify_resource_exists "/api/monitor-probe" "$PAIRING_ID"; then
    print_failed "Monitor Probe Verification"
fi

RESPONSE=$(api_get_resource "/api/monitor-probe" "$PAIRING_ID" \
    '{"_id": true, "probeId": true, "monitorId": true, "isEnabled": true}')

validation_failed=0

validate_field "$RESPONSE" "isEnabled" "true" || validation_failed=1

API_PROBE_ID=$(echo "$RESPONSE" | jq -r '.probeId // empty')
API_MONITOR_ID=$(echo "$RESPONSE" | jq -r '.monitorId // empty')
assert_equals "$PROBE_ID" "$API_PROBE_ID" "probeId" || validation_failed=1
assert_equals "$MONITOR_ID" "$API_MONITOR_ID" "monitorId" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Monitor Probe Verification"
fi

print_passed "Monitor Probe Verification"
