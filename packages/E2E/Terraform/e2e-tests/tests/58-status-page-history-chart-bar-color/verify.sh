#!/bin/bash
# Verify script for 58-status-page-history-chart-bar-color.
#
# Issue #4719: the API answered a bar color rule's uptime percent as text
# ("100"), and the provider read the text as null, so every apply failed.
# Checks the API stored each rule's uptime percent as the number the
# configuration wrote and answers it as a JSON number, that the provider read
# each one back as written, and that the data source found the rule by id and
# by its uptime percent. The runner's drift gate and import round-trip check
# that every later plan is empty.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

TEST_NAME="Status Page History Chart Bar Color Verification"
RULE_ENDPOINT="/api/status-page-history-chart-bar-color-rule"

print_header "$TEST_NAME"

PAGE_ID=$(get_output status_page_id)
DEGRADED_ID=$(get_output status_page_history_chart_bar_color_rule_id)
OPERATIONAL_ID=$(get_output operational_rule)
NEARLY_ID=$(get_output nearly_rule)
ONE_MINUTE_ID=$(get_output one_minute_rule)
OFFLINE_ID=$(get_output offline_rule)

assert_not_empty "$PAGE_ID" "status_page_id" || print_failed "$TEST_NAME"
assert_not_empty "$DEGRADED_ID" "the degraded rule" || print_failed "$TEST_NAME"
assert_not_empty "$OPERATIONAL_ID" "the operational rule" || print_failed "$TEST_NAME"
assert_not_empty "$NEARLY_ID" "the nearly rule" || print_failed "$TEST_NAME"
assert_not_empty "$ONE_MINUTE_ID" "the one-minute rule" || print_failed "$TEST_NAME"
assert_not_empty "$OFFLINE_ID" "the offline rule" || print_failed "$TEST_NAME"

failed=0

# check_stored_uptime <what> <rule id> <the number the API should hold>
#
# The API's own answer, read with jq: a JSON number (not the text Postgres
# hands the server), equal to the number the configuration wrote.
check_stored_uptime() {
    local what="$1"
    local id="$2"
    local expected="$3"
    local response
    local uptime
    local kind

    response=$(api_get_resource "$RULE_ENDPOINT" "$id" '{"_id": true, "uptimePercentGreaterThanOrEqualTo": true}')
    uptime=$(echo "$response" | jq -c '.uptimePercentGreaterThanOrEqualTo')
    kind=$(echo "$response" | jq -r '.uptimePercentGreaterThanOrEqualTo | type')

    if [ "$kind" != "number" ]; then
        echo "    ✗ $what: the API answered its uptime percent as a $kind ($uptime), not a number. Response: $response"
        failed=1
        return 0
    fi

    if [ "$(echo "$response" | jq --argjson want "$expected" '.uptimePercentGreaterThanOrEqualTo == $want')" != "true" ]; then
        echo "    ✗ $what: the API holds $uptime, not $expected"
        failed=1
        return 0
    fi

    echo "    ✓ $what: the API holds $uptime, as a number"
}

check_stored_uptime "the operational rule" "$OPERATIONAL_ID" 100
check_stored_uptime "the degraded rule" "$DEGRADED_ID" 99.65
check_stored_uptime "the nearly rule" "$NEARLY_ID" 99.999
# 100 * (1 - 1 / 1440), as near as a number the API keeps can be.
check_stored_uptime "the one-minute rule" "$ONE_MINUTE_ID" 99.93055555555556
check_stored_uptime "the offline rule" "$OFFLINE_ID" 0

# What the provider read back, as Terraform prints it.
assert_equals "100" "$(get_output operational_uptime)" "the operational rule's uptime percent" || failed=1
assert_equals "99.65" "$(get_output degraded_uptime)" "the degraded rule's uptime percent" || failed=1
assert_equals "99.999" "$(get_output nearly_uptime)" "the nearly rule's uptime percent" || failed=1
assert_equals "0" "$(get_output offline_uptime)" "the offline rule's uptime percent" || failed=1

# The data source, by id and by the uptime percent.
assert_equals "$DEGRADED_ID" "$(get_output found_by_id)" "the rule looked up by id" || failed=1
assert_equals "99.65" "$(get_output found_by_id_uptime)" "the uptime percent of the rule looked up by id" || failed=1
assert_equals "$DEGRADED_ID" "$(get_output found_by_uptime)" "the rule looked up by its uptime percent" || failed=1
assert_equals "#F97316" "$(get_output found_by_uptime_color | tr '[:lower:]' '[:upper:]')" "the color of the rule looked up by its uptime percent" || failed=1

if [ $failed -eq 1 ]; then
    print_failed "$TEST_NAME"
fi

print_passed "$TEST_NAME"
