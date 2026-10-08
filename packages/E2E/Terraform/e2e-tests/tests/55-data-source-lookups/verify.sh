#!/bin/bash
# Verify script for 55-data-source-lookups.
#
# Every lookup must have found the record it was pointed at - by name, by id,
# by a number, and by two arguments together - and read the rest of it.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Data Source Lookups Verification"

LABEL_ID=$(get_output label_id)
STATUS_ID=$(get_output monitor_status_id)

assert_not_empty "$LABEL_ID" "label_id" || print_failed "Data Source Lookups Verification"
assert_not_empty "$STATUS_ID" "monitor_status_id" || print_failed "Data Source Lookups Verification"

validation_failed=0

assert_equals "$LABEL_ID" "$(get_output label_found_by_name)" "the label looked up by name" || validation_failed=1
assert_equals "TF E2E Lookup Label" "$(get_output label_found_by_id_name)" "the name of the label looked up by id" || validation_failed=1
assert_equals "$STATUS_ID" "$(get_output status_found_by_priority)" "the status looked up by priority" || validation_failed=1
assert_equals "$STATUS_ID" "$(get_output status_found_by_name_and_state)" "the status looked up by name and state" || validation_failed=1
assert_equals "#16a085" "$(get_output status_found_by_priority_color | tr '[:upper:]' '[:lower:]')" "the color of the status looked up by priority" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Data Source Lookups Verification"
fi

print_passed "Data Source Lookups Verification"
