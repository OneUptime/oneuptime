#!/bin/bash
# Post-update verify script for 69-labels-others-add-stay
# (OneUptime/oneuptime#10134): update.tf took the configuration's label out
# and listed another, and the apply - which adds and takes off single labels
# (#10135) - took off only the label taken out. The label verify.sh added
# through the API stayed.
#
# It then takes that label off through the API, as a person can: a label the
# configuration never listed is no drift when it goes either, so the runner's
# drift gate passes, and the import round trip that follows adopts the
# configuration's label only.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"
source "$SCRIPT_DIR/monitor-labels.sh"

TEST_NAME="Labels Someone Else Adds Stay After An Update"
print_header "$TEST_NAME"

assert_monitor_labels "$(sorted "$CHECKOUT" "$ADDED_OUTSIDE")" \
    "the label update.tf lists and the one added outside, without the one it took out" ||
    print_failed "$TEST_NAME"

assert_state_labels "$CHECKOUT" "the label update.tf lists only" ||
    print_failed "$TEST_NAME"

echo "    Taking the label added outside off through the API, as a person can..."
change_monitor_labels "{\"removeFromList\": {\"labels\": [\"$ADDED_OUTSIDE\"]}}" ||
    print_failed "$TEST_NAME"

assert_monitor_labels "$CHECKOUT" "the label update.tf lists only" ||
    print_failed "$TEST_NAME"

print_passed "$TEST_NAME"
