#!/bin/bash
# Post-update verify script for 52-custom-fields test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Custom Fields Update Verification"

MONITOR_FIELD_ID=$(get_output monitor_custom_field_id)
INCIDENT_FIELD_ID=$(get_output incident_custom_field_id)
ALERT_FIELD_ID=$(get_output alert_custom_field_id)

validation_failed=0

MONITOR_RESPONSE=$(api_get_resource "/api/monitor-custom-field" "$MONITOR_FIELD_ID" \
    '{"_id": true, "name": true, "description": true}')
INCIDENT_RESPONSE=$(api_get_resource "/api/incident-custom-field" "$INCIDENT_FIELD_ID" \
    '{"_id": true, "name": true, "description": true, "sortOrder": true, "showOnCreate": true, "isRequiredOnCreate": true, "includeInSubscriberNotifications": true, "variableKey": true}')
ALERT_RESPONSE=$(api_get_resource "/api/alert-custom-field" "$ALERT_FIELD_ID" \
    '{"_id": true, "description": true}')

validate_field "$MONITOR_RESPONSE" "name" "terraform-e2e-monitor-field-updated" || validation_failed=1
validate_field "$MONITOR_RESPONSE" "description" "Monitor custom field updated by Terraform E2E tests" || validation_failed=1
validate_field "$INCIDENT_RESPONSE" "description" "Incident custom field updated by Terraform E2E tests" || validation_failed=1
validate_field "$INCIDENT_RESPONSE" "name" "terraform-e2e-incident-field-renamed" || validation_failed=1
validate_field "$INCIDENT_RESPONSE" "sortOrder" "2" || validation_failed=1
validate_field "$INCIDENT_RESPONSE" "showOnCreate" "true" || validation_failed=1
validate_field "$INCIDENT_RESPONSE" "isRequiredOnCreate" "false" || validation_failed=1
validate_field "$INCIDENT_RESPONSE" "includeInSubscriberNotifications" "false" || validation_failed=1

# Renaming the field keeps its template key, so templates that use it keep working.
validate_field "$INCIDENT_RESPONSE" "variableKey" "terraform_e2e_incident_field" || validation_failed=1
assert_equals "terraform_e2e_incident_field" "$(get_output incident_custom_field_variable_key)" \
    "incident_custom_field_variable_key output" || validation_failed=1
validate_field "$ALERT_RESPONSE" "description" "Alert custom field updated by Terraform E2E tests" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Custom Fields Update Verification"
fi

print_passed "Custom Fields Update Verification"
