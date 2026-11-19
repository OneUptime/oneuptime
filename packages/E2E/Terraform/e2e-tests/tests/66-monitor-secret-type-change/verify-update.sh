#!/bin/bash
# Post-update verify script for 66-monitor-secret-type-change
#
# update.tf changed the secret's type to TOTP together with a new value, the
# way OneUptime changes a type (#9760). It must be the same secret - the ID
# verify.sh recorded - now a one-time code secret: replacing it would lose
# its ID and the monitors and labels it is shared with (#9814).

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Monitor Secret Type Update Verification"

SECRET_ID=$(get_output monitor_secret_id)
RECORDED="${TMPDIR:-/tmp}/oneuptime-e2e-monitor-secret-${SECRET_ID}"

if [ ! -f "$RECORDED" ]; then
    echo "    ✗ The secret is not the one verify.sh recorded: the update replaced it, and it is now $SECRET_ID"
    print_failed "Monitor Secret Type Update Verification"
fi
rm -f "$RECORDED"
echo "    ✓ The secret kept its ID: $SECRET_ID"

if ! verify_resource_exists "/api/monitor-secret" "$SECRET_ID"; then
    print_failed "Monitor Secret Type Update Verification"
fi

RESPONSE=$(api_get_resource "/api/monitor-secret" "$SECRET_ID" '{"_id": true, "secretType": true}')

validation_failed=0
validate_field "$RESPONSE" "secretType" "TOTP" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Monitor Secret Type Update Verification"
fi

print_passed "Monitor Secret Type Update Verification"
