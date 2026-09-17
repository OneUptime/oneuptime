#!/bin/bash
# Post-update verify script for 49-monitor-probe test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Monitor Probe Update Verification"

PAIRING_ID=$(get_output monitor_probe_id)

RESPONSE=$(api_get_resource "/api/monitor-probe" "$PAIRING_ID" \
    '{"_id": true, "isEnabled": true}')

validation_failed=0

validate_field "$RESPONSE" "isEnabled" "false" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Monitor Probe Update Verification"
fi

print_passed "Monitor Probe Update Verification"
