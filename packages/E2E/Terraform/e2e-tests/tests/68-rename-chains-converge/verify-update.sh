#!/bin/bash
# Post-update verify script for 68-rename-chains-converge
# (OneUptime/oneuptime#9855): once update.tf has renamed every record in a
# chain in one apply - each taking the name the next one gives up - every
# record holds exactly the name its configuration gives it.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

RENAME_CHAINS_TEST_NAME="Rename Chains Update Verification" \
    bash "$SCRIPT_DIR/verify.sh"
