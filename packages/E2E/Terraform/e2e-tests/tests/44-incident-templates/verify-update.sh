#!/bin/bash
# Post-update verify script for 44-incident-templates test

set -e

# Source common library
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Incident Templates Update Verification"

TEMPLATE_ID=$(get_output incident_templates_id)
NOTE_TEMPLATE_ID=$(get_output incident_note_template_id)

TEMPLATE_RESPONSE=$(api_get_resource "/api/incident-templates" "$TEMPLATE_ID" \
    '{"_id": true, "templateDescription": true, "title": true}')
NOTE_RESPONSE=$(api_get_resource "/api/incident-note-template" "$NOTE_TEMPLATE_ID" \
    '{"_id": true, "note": true}')

validation_failed=0

validate_field "$TEMPLATE_RESPONSE" "templateDescription" "Incident template updated by Terraform E2E tests" || validation_failed=1
validate_field "$TEMPLATE_RESPONSE" "title" "terraform-e2e-templated-incident-updated" || validation_failed=1
validate_field "$NOTE_RESPONSE" "note" "This incident has been mitigated." || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Incident Templates Update Verification"
fi

print_passed "Incident Templates Update Verification"
