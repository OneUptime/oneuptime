#!/bin/bash
# Verify script for 60-import-by-parent.
#
# Each row joins what the configuration says, as the API has it: the
# monitor's owners are the test account and the team, the layer and the
# escalation rule page the test account, and the rule pages the team and
# the schedule too. The runner's import round trip then imports each of them
# by what it joins (import-ids.txt) and requires a clean plan.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/../../scripts/lib.sh"

print_header "Import By Parent Verification"

ME=$(get_output me_user)
TEAM=$(get_output sre_team)
SCHEDULE=$(get_output weekly_schedule)
MONITOR=$(get_output monitor)
RULE=$(get_output rule)

assert_not_empty "$ME" "the test account's user id" || print_failed "Import By Parent Verification"
assert_not_empty "$TEAM" "the team's id" || print_failed "Import By Parent Verification"

validation_failed=0

# check <api path> <output with the row's id> <select> <field> <expected>...
check() {
    local endpoint="$1"
    local output="$2"
    shift 2
    local id
    id=$(get_output "$output")
    local select='{"_id": true'
    local args=("$@")
    local i
    for ((i = 0; i < ${#args[@]}; i += 2)); do
        select="$select, \"${args[$i]}\": true"
    done
    select="$select}"
    local response
    response=$(api_get_resource "$endpoint" "$id" "$select")
    for ((i = 0; i < ${#args[@]}; i += 2)); do
        validate_field "$response" "${args[$i]}" "${args[$((i + 1))]}" || validation_failed=1
    done
}

check "/api/monitor-owner-user" monitor_owner_user_id monitorId "$MONITOR" userId "$ME"
check "/api/monitor-owner-team" monitor_owner_team_id monitorId "$MONITOR" teamId "$TEAM"
check "/api/on-call-duty-schedule-layer-user" on_call_duty_schedule_layer_user_id userId "$ME"
check "/api/on-call-duty-policy-escalation-rule-user" on_call_duty_policy_escalation_rule_user_id onCallDutyPolicyEscalationRuleId "$RULE" userId "$ME"
check "/api/on-call-duty-policy-escalation-rule-team" on_call_duty_policy_escalation_rule_team_id onCallDutyPolicyEscalationRuleId "$RULE" teamId "$TEAM"
check "/api/on-call-duty-policy-escalation-rule-schedule" on_call_duty_policy_escalation_rule_schedule_id onCallDutyPolicyEscalationRuleId "$RULE" onCallDutyPolicyScheduleId "$SCHEDULE"

if [ $validation_failed -eq 1 ]; then
    print_failed "Import By Parent Verification"
fi

print_passed "Import By Parent Verification"
