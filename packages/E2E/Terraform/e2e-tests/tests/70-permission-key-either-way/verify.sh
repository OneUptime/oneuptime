#!/bin/bash
# Verify script for 70-permission-key-either-way (#10300): each permission,
# written with jsonencode(), reached OneUptime as its key - not as the key's
# JSON text, quotes and all, which OneUptime would have refused.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

TEST_NAME="${PERMISSION_KEY_TEST_NAME:-Permission Key Verification}"

print_header "$TEST_NAME"

# Where the rows' IDs are kept for verify-update.sh, which checks the update
# kept the same rows.
IDS_FILE="${TMPDIR:-/tmp}/oneuptime-e2e-70-permission-key-ids-${TF_VAR_project_id:-project}"

validation_failed=0

# check_permission <output> <endpoint> <key>
check_permission() {
    local output="$1"
    local endpoint="$2"
    local key="$3"

    local id
    id=$(get_output "$output")
    assert_not_empty "$id" "$output" || return 1

    if ! verify_resource_exists "$endpoint" "$id"; then
        return 1
    fi

    local response
    response=$(api_get_resource "$endpoint" "$id" '{"_id": true, "permission": true}')

    # The key, as a string: jq -r prints a JSON string without its quotes.
    local kept
    kept=$(echo "$response" | jq -r '.permission // empty')
    assert_equals "$key" "$kept" "$output permission" || return 1

    echo "$output=$id" >> "$IDS_FILE.new"
}

rm -f "$IDS_FILE.new"

check_permission team_permission_id "/api/team-permission" "ReadProjectMonitor" || validation_failed=1
check_permission api_key_permission_id "/api/api-key-permission" "ReadProjectMonitor" || validation_failed=1
check_permission custom_role_permission_id "/api/custom-role-permission" "IncidentMember" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    rm -f "$IDS_FILE.new"
    print_failed "$TEST_NAME"
fi

# Only the first verify keeps the IDs; verify-update.sh compares with them.
if [ -z "${PERMISSION_KEY_AFTER_UPDATE:-}" ]; then
    mv "$IDS_FILE.new" "$IDS_FILE"
else
    rm -f "$IDS_FILE.new"
fi

print_passed "$TEST_NAME"
