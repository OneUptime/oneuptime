#!/bin/bash
# Post-update verify script for 64-ordered-lists-converge
# (OneUptime/oneuptime#9573): once update.tf has renumbered every list in
# one apply - rows added and taken out of the middle, the rest renumbered -
# every row holds exactly the order its configuration gives it.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

ORDERED_LISTS_TEST_NAME="Numbered Lists Update Verification" \
    bash "$SCRIPT_DIR/verify.sh"
