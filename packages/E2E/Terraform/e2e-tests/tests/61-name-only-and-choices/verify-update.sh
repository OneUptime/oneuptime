#!/bin/bash
# Verify-update script for 61-name-only-and-choices.
#
# The update gave the probe a description. Its generated key and its
# version are what they were: an update that leaves them out of the
# configuration never changes them.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Name-only probe update Verification"

validation_failed=0

PROBE_ID=$(get_output probe_id)
PROBE_KEY=$(get_output probe_key)
FIELD_ID=$(get_output incident_custom_field_id)

PROBE_RESPONSE=$(api_get_resource "/api/probe" "$PROBE_ID" \
    '{"_id": true, "description": true, "key": true, "probeVersion": true}')
validate_field "$PROBE_RESPONSE" "description" "Runs in the e2e stack" || validation_failed=1
validate_field "$PROBE_RESPONSE" "key" "$PROBE_KEY" || validation_failed=1
validate_field "$PROBE_RESPONSE" "probeVersion" "1.0.0" || validation_failed=1
assert_not_empty "$PROBE_KEY" "probe key after the update" || validation_failed=1
assert_sensitive "oneuptime_probe.name_only" "key" || validation_failed=1

FIELD_RESPONSE=$(api_get_resource "/api/incident-custom-field" "$FIELD_ID" \
    '{"_id": true, "customFieldType": true, "dropdownOptions": true}')
validate_field "$FIELD_RESPONSE" "customFieldType" "Dropdown" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Name-only probe update Verification"
fi

print_passed "Name-only probe update Verification"
