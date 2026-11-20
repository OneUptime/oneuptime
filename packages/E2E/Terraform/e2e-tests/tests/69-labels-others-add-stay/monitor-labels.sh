#!/bin/bash
# What 69-labels-others-add-stay's verify scripts share: the monitor and its
# labels from the outputs, the monitor's labels as the API reads them, and an
# update that adds or takes off single labels (addToList and removeFromList,
# OneUptime/oneuptime#10135). Sourced after lib.sh.

MONITOR_ID=$(get_output monitor_id)
PAYMENTS=$(get_output label_id)
CHECKOUT=$(get_output checkout_label)
ADDED_OUTSIDE=$(get_output added_outside_label)

assert_not_empty "$MONITOR_ID" "monitor_id"
assert_not_empty "$PAYMENTS" "label_id"
assert_not_empty "$CHECKOUT" "checkout_label"
assert_not_empty "$ADDED_OUTSIDE" "added_outside_label"

# IDs, one per line, sorted.
sorted() {
    printf '%s\n' "$@" | sort
}

# The monitor's label IDs as the API reads them, one per line, sorted. An ID
# may come as text, as {"_id": ...}, or wrapped as {"_type": "ObjectID",
# "value": ...}.
monitor_labels() {
    api_get_resource "/api/monitor" "$MONITOR_ID" '{"_id": true, "labels": true}' |
        jq -r '[.labels[]?
            | if type == "object" then (._id // .id) else . end
            | if type == "object" then .value else . end
            | select(. != null)] | sort | .[]'
}

# Fails unless the monitor has exactly these labels, one per line, sorted.
assert_monitor_labels() {
    local expected="$1"
    local what="$2"
    local actual
    actual=$(monitor_labels)

    if [ "$actual" != "$expected" ]; then
        echo "    ✗ FAILED: the monitor does not have $what"
        echo "      Expected: $(echo $expected)"
        echo "      Got:      $(echo $actual)"
        return 1
    fi

    echo "    ✓ The monitor has $what"
}

# Fails unless the state holds exactly these labels for the monitor.
assert_state_labels() {
    local expected="$1"
    local what="$2"
    local actual
    actual=$(terraform output -json monitor_labels | jq -r 'sort | .[]')

    if [ "$actual" != "$expected" ]; then
        echo "    ✗ FAILED: the state does not hold $what"
        echo "      Expected: $(echo $expected)"
        echo "      Got:      $(echo $actual)"
        return 1
    fi

    echo "    ✓ The state holds $what"
}

# Sends an update of the monitor whose body names single labels to add or
# take off. Fails unless the API answers 200.
change_monitor_labels() {
    local body="$1"
    local answer
    answer=$(curl -s --max-time 30 -w $'\n%{http_code}' -X PUT "${ONEUPTIME_URL}/api/monitor/${MONITOR_ID}" \
        -H "Content-Type: application/json" \
        -H "Apikey: $TF_VAR_api_key" \
        -H "projectid: $TF_VAR_project_id" \
        -d "$body")
    local status="${answer##*$'\n'}"

    if [ "$status" != "200" ]; then
        echo "    ✗ FAILED: the update $body was answered $status: ${answer%$'\n'*}"
        return 1
    fi

    echo "    ✓ The API took the update $body"
}
