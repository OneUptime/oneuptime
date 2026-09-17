#!/bin/bash
# Verify script for 52-custom-fields test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Custom Fields Verification"

MONITOR_FIELD_ID=$(get_output monitor_custom_field_id)
INCIDENT_FIELD_ID=$(get_output incident_custom_field_id)
ALERT_FIELD_ID=$(get_output alert_custom_field_id)

echo "  Verifying custom fields via API..."
echo "    Monitor field ID: $MONITOR_FIELD_ID"
echo "    Incident field ID: $INCIDENT_FIELD_ID"
echo "    Alert field ID: $ALERT_FIELD_ID"

assert_not_empty "$MONITOR_FIELD_ID" "Monitor custom field id" || print_failed "Custom Fields Verification"
assert_not_empty "$INCIDENT_FIELD_ID" "Incident custom field id" || print_failed "Custom Fields Verification"
assert_not_empty "$ALERT_FIELD_ID" "Alert custom field id" || print_failed "Custom Fields Verification"

validation_failed=0

MONITOR_RESPONSE=$(api_get_resource "/api/monitor-custom-field" "$MONITOR_FIELD_ID" \
    '{"_id": true, "name": true, "customFieldType": true}')
INCIDENT_RESPONSE=$(api_get_resource "/api/incident-custom-field" "$INCIDENT_FIELD_ID" \
    '{"_id": true, "name": true, "customFieldType": true}')
ALERT_RESPONSE=$(api_get_resource "/api/alert-custom-field" "$ALERT_FIELD_ID" \
    '{"_id": true, "name": true, "customFieldType": true}')

validate_field "$MONITOR_RESPONSE" "name" "terraform-e2e-monitor-field" || validation_failed=1
validate_field "$MONITOR_RESPONSE" "customFieldType" "Text" || validation_failed=1
validate_field "$INCIDENT_RESPONSE" "name" "terraform-e2e-incident-field" || validation_failed=1
validate_field "$INCIDENT_RESPONSE" "customFieldType" "Number" || validation_failed=1
validate_field "$ALERT_RESPONSE" "name" "terraform-e2e-alert-field" || validation_failed=1
validate_field "$ALERT_RESPONSE" "customFieldType" "Boolean" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Custom Fields Verification"
fi

print_passed "Custom Fields Verification"
