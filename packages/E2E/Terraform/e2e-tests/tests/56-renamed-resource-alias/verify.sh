#!/bin/bash
# Verify script for 56-renamed-resource-alias.
#
# Both fleets exist in the API, and each data source found the fleet the
# other resource name created: the old name and the new one are the same
# resource.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Renamed Resource Alias Verification"

OLD_NAME_FLEET=$(get_output iot_fleet_id)
NEW_NAME_FLEET=$(get_output new_name_fleet)

assert_not_empty "$OLD_NAME_FLEET" "the fleet created under the old name" || print_failed "Renamed Resource Alias Verification"
assert_not_empty "$NEW_NAME_FLEET" "the fleet created under the new name" || print_failed "Renamed Resource Alias Verification"

validation_failed=0

for fleet in "$OLD_NAME_FLEET" "$NEW_NAME_FLEET"; do
    if ! verify_resource_exists "/api/iot-fleet" "$fleet"; then
        validation_failed=1
    fi
done

RESPONSE=$(api_get_resource "/api/iot-fleet" "$OLD_NAME_FLEET" '{"_id": true, "name": true}')
validate_field "$RESPONSE" "name" "TF E2E Fleet Old Name" || validation_failed=1

assert_equals "$OLD_NAME_FLEET" "$(get_output old_name_fleet_found_by_new_data_source)" "the old-name fleet, found by oneuptime_iot_fleet" || validation_failed=1
assert_equals "$NEW_NAME_FLEET" "$(get_output new_name_fleet_found_by_old_data_source)" "the new-name fleet, found by oneuptime_io_t_fleet" || validation_failed=1

if [ $validation_failed -eq 1 ]; then
    print_failed "Renamed Resource Alias Verification"
fi

print_passed "Renamed Resource Alias Verification"
