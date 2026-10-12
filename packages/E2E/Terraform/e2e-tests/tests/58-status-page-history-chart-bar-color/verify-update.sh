#!/bin/bash
# Verify-update script for 58-status-page-history-chart-bar-color.
#
# update.tf changed two uptime percents in place (99.999 -> 99.99, 99.65 ->
# 99.5) and the bottom rule's color. Checks the API holds the new numbers,
# as JSON numbers, left the other rules as they were, and that the lookup by
# uptime percent follows the rule to its new one.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

TEST_NAME="Status Page History Chart Bar Color Update Verification"
RULE_ENDPOINT="/api/status-page-history-chart-bar-color-rule"

print_header "$TEST_NAME"

DEGRADED_ID=$(get_output status_page_history_chart_bar_color_rule_id)
OPERATIONAL_ID=$(get_output operational_rule)
NEARLY_ID=$(get_output nearly_rule)
ONE_MINUTE_ID=$(get_output one_minute_rule)
OFFLINE_ID=$(get_output offline_rule)

failed=0

# check_stored_uptime <what> <rule id> <the number the API should hold>
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

# Changed.
check_stored_uptime "the nearly rule" "$NEARLY_ID" 99.99
check_stored_uptime "the degraded rule" "$DEGRADED_ID" 99.5
# As they were.
check_stored_uptime "the operational rule" "$OPERATIONAL_ID" 100
check_stored_uptime "the one-minute rule" "$ONE_MINUTE_ID" 99.93055555555556
check_stored_uptime "the offline rule" "$OFFLINE_ID" 0

OFFLINE_COLOR=$(api_get_resource "$RULE_ENDPOINT" "$OFFLINE_ID" '{"_id": true, "barColor": true}' | jq -r '.barColor.value // .barColor')
assert_equals "#450A0A" "$(echo "$OFFLINE_COLOR" | tr '[:lower:]' '[:upper:]')" "the offline rule's new color" || failed=1

assert_equals "99.99" "$(get_output nearly_uptime)" "the nearly rule's new uptime percent" || failed=1
assert_equals "99.5" "$(get_output degraded_uptime)" "the degraded rule's new uptime percent" || failed=1

# The lookups follow the rule to its new number.
assert_equals "$DEGRADED_ID" "$(get_output found_by_uptime)" "the rule looked up by its new uptime percent" || failed=1
assert_equals "99.5" "$(get_output found_by_id_uptime)" "the uptime percent of the rule looked up by id" || failed=1

if [ $failed -eq 1 ]; then
    print_failed "$TEST_NAME"
fi

print_passed "$TEST_NAME"
