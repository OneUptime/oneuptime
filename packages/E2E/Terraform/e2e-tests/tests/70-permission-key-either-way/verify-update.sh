#!/bin/bash
# Post-update verify script for 70-permission-key-either-way (#10300):
# update.tf wrote each permission as its key, where main.tf wrote it with
# jsonencode(). That is the same permission, so nothing changed: OneUptime
# still keeps each key, and each is the same row - the update replaced none.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

TEST_NAME="Permission Key Update Verification"

PERMISSION_KEY_TEST_NAME="$TEST_NAME" PERMISSION_KEY_AFTER_UPDATE=1 \
    bash "$SCRIPT_DIR/verify.sh"

IDS_FILE="${TMPDIR:-/tmp}/oneuptime-e2e-70-permission-key-ids-${TF_VAR_project_id:-project}"

if [ ! -f "$IDS_FILE" ]; then
    echo "    ✗ FAILED: verify.sh kept no IDs to compare with ($IDS_FILE)"
    print_failed "$TEST_NAME"
fi

validation_failed=0

while IFS='=' read -r output before; do
    if [ -z "$output" ]; then
        continue
    fi
    assert_equals "$before" "$(get_output "$output")" "$output, the same row as before the update" || validation_failed=1
done < "$IDS_FILE"

rm -f "$IDS_FILE"

if [ $validation_failed -eq 1 ]; then
    print_failed "$TEST_NAME"
fi

print_passed "$TEST_NAME"
