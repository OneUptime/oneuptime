#!/bin/bash
set -e

echo "=== Alert CRUD Test Verification ==="

# Get outputs
BASIC_ID=$(terraform output -raw basic_alert_id 2>/dev/null || echo "")
ROOT_CAUSE_ID=$(terraform output -raw root_cause_alert_id 2>/dev/null || echo "")
LABELED_ID=$(terraform output -raw labeled_alert_id 2>/dev/null || echo "")
SEVERITY_ID=$(terraform output -raw severity_id 2>/dev/null || echo "")
STATE_ID=$(terraform output -raw state_id 2>/dev/null || echo "")
MONITOR_ID=$(terraform output -raw monitor_id 2>/dev/null || echo "")

echo "Basic Alert ID: $BASIC_ID"
echo "Root Cause Alert ID: $ROOT_CAUSE_ID"
echo "Labeled Alert ID: $LABELED_ID"
echo "Severity ID: $SEVERITY_ID"
echo "State ID: $STATE_ID"
echo "Monitor ID: $MONITOR_ID"

# Verify all resources created
if [ -z "$BASIC_ID" ]; then
    echo "ERROR: Basic alert not created"
    exit 1
fi

if [ -z "$ROOT_CAUSE_ID" ]; then
    echo "ERROR: Root cause alert not created"
    exit 1
fi

if [ -z "$LABELED_ID" ]; then
    echo "ERROR: Labeled alert not created"
    exit 1
fi

if [ -z "$SEVERITY_ID" ]; then
    echo "ERROR: Severity not created"
    exit 1
fi

if [ -z "$STATE_ID" ]; then
    echo "ERROR: State not created"
    exit 1
fi

if [ -z "$MONITOR_ID" ]; then
    echo "ERROR: Monitor not created"
    exit 1
fi

# The state an alert was created in, as the API reads it back.
current_state_of() {
    curl -s -X POST "${ONEUPTIME_URL}/api/alert/$1/get-item" \
        -H "Content-Type: application/json" \
        -H "Apikey: $TF_VAR_api_key" \
        -H "projectid: $TF_VAR_project_id" \
        -d '{"select": {"_id": true, "currentAlertStateId": true}}' |
        jq -r '.currentAlertStateId | if type == "object" then .value else . end // empty'
}

INITIAL_STATE_ID=$(terraform output -raw initial_state_alert_id 2>/dev/null || echo "")
INITIAL_STATE_OUTPUT=$(terraform output -raw initial_state_alert_current_state 2>/dev/null || echo "")

if [ -z "$INITIAL_STATE_ID" ]; then
    echo "ERROR: Alert with an initial state not created"
    exit 1
fi

# Created with current_alert_state_id: it starts in that state.
INITIAL_STATE_API=$(current_state_of "$INITIAL_STATE_ID")
if [ "$INITIAL_STATE_API" != "$STATE_ID" ]; then
    echo "ERROR: Alert created with current_alert_state_id = $STATE_ID is in state '$INITIAL_STATE_API'"
    exit 1
fi
echo "Alert created in the state it named: $INITIAL_STATE_API"

if [ "$INITIAL_STATE_OUTPUT" != "$STATE_ID" ]; then
    echo "ERROR: Terraform holds current_alert_state_id '$INITIAL_STATE_OUTPUT', expected '$STATE_ID'"
    exit 1
fi

# Created without one: it starts in the project's created state, not that one.
BASIC_STATE_API=$(current_state_of "$BASIC_ID")
if [ -z "$BASIC_STATE_API" ] || [ "$BASIC_STATE_API" = "$STATE_ID" ]; then
    echo "ERROR: Alert created without a state is in state '$BASIC_STATE_API'"
    exit 1
fi
echo "Alert created without a state is in the project's created state: $BASIC_STATE_API"

echo ""
echo "=== Alert CRUD Test PASSED ==="
