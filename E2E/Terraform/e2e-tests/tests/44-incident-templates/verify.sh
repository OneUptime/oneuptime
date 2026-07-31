#!/bin/bash
# Verify script for 44-incident-templates test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Incident Templates Verification"

SEVERITY_ID=$(get_output incident_severity_id)
TEMPLATE_ID=$(get_output incident_templates_id)
NOTE_TEMPLATE_ID=$(get_output incident_note_template_id)
TEMPLATE_NAME=$(get_output incident_template_name)

echo "  Verifying incident templates via API..."
echo "    Template ID: $TEMPLATE_ID"
echo "    Note Template ID: $NOTE_TEMPLATE_ID"

assert_not_empty "$TEMPLATE_ID" "Incident template id" || print_failed "Incident Templates Verification"
assert_not_empty "$NOTE_TEMPLATE_ID" "Incident note template id" || print_failed "Incident Templates Verification"

if ! verify_resource_exists "/api/incident-templates" "$TEMPLATE_ID"; then
    print_failed "Incident Templates Verification"
fi

if ! verify_resource_exists "/api/incident-note-template" "$NOTE_TEMPLATE_ID"; then
    print_failed "Incident Templates Verification"
fi

TEMPLATE_RESPONSE=$(api_get_resource "/api/incident-templates" "$TEMPLATE_ID" \
    '{"_id": true, "templateName": true, "title": true, "incidentSeverityId": true}')
NOTE_RESPONSE=$(api_get_resource "/api/incident-note-template" "$NOTE_TEMPLATE_ID" \
    '{"_id": true, "templateName": true, "note": true}')

validation_failed=0

validate_field "$TEMPLATE_RESPONSE" "templateName" "$TEMPLATE_NAME" || validation_failed=1
validate_field "$TEMPLATE_RESPONSE" "title" "terraform-e2e-templated-incident" || validation_failed=1
validate_field "$NOTE_RESPONSE" "templateName" "terraform-e2e-note-template" || validation_failed=1
validate_field "$NOTE_RESPONSE" "note" "This incident is being investigated." || validation_failed=1

# The template must reference the severity created in this fixture
API_SEVERITY_ID=$(echo "$TEMPLATE_RESPONSE" | jq -r '.incidentSeverityId // empty')
assert_equals "$SEVERITY_ID" "$API_SEVERITY_ID" "incidentSeverityId" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Incident Templates Verification"
fi

print_passed "Incident Templates Verification"
