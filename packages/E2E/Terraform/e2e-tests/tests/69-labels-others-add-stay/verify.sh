#!/bin/bash
# Verify script for 69-labels-others-add-stay (OneUptime/oneuptime#10134):
# the monitor has the configuration's label, and a label added through the
# API - as a label rule adds one, with an update that names only that label
# (#10135) - joins it. The runner's drift gate that follows requires a clean
# plan: the label added outside is not the configuration's, so no plan shows
# it and no apply takes it off.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"
source "$SCRIPT_DIR/monitor-labels.sh"

TEST_NAME="Labels Someone Else Adds Stay"
print_header "$TEST_NAME"

assert_monitor_labels "$PAYMENTS" "the configuration's label" ||
    print_failed "$TEST_NAME"

echo "    Adding a label through the API, as a label rule does..."
change_monitor_labels "{\"addToList\": {\"labels\": [\"$ADDED_OUTSIDE\"]}}" ||
    print_failed "$TEST_NAME"

assert_monitor_labels "$(sorted "$PAYMENTS" "$ADDED_OUTSIDE")" \
    "the configuration's label and the one added outside" ||
    print_failed "$TEST_NAME"

assert_state_labels "$PAYMENTS" "the configuration's label only" ||
    print_failed "$TEST_NAME"

print_passed "$TEST_NAME"
