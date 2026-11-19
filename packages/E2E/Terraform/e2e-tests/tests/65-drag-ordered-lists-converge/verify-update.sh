#!/bin/bash
# Post-update verify script for 65-drag-ordered-lists-converge
# (OneUptime/oneuptime#9609): once update.tf has renumbered every list in
# one apply - a row added in the middle, the rest renumbered - every row
# holds exactly the number its configuration gives it.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DRAG_ORDERED_LISTS_TEST_NAME="Drag-Ordered Lists Update Verification" \
    bash "$SCRIPT_DIR/verify.sh"
