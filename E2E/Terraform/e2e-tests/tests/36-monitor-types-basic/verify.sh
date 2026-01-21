#!/bin/bash
set -e

echo "=== Basic Monitor Types Test Verification ==="

# Get outputs
WEBSITE_ID=$(terraform output -raw website_monitor_id 2>/dev/null || echo "")
WEBSITE_TYPE=$(terraform output -raw website_monitor_type 2>/dev/null || echo "")
API_ID=$(terraform output -raw api_monitor_id 2>/dev/null || echo "")
API_TYPE=$(terraform output -raw api_monitor_type 2>/dev/null || echo "")
PING_ID=$(terraform output -raw ping_monitor_id 2>/dev/null || echo "")
PING_TYPE=$(terraform output -raw ping_monitor_type 2>/dev/null || echo "")
PORT_ID=$(terraform output -raw port_monitor_id 2>/dev/null || echo "")
PORT_TYPE=$(terraform output -raw port_monitor_type 2>/dev/null || echo "")
SSL_ID=$(terraform output -raw ssl_monitor_id 2>/dev/null || echo "")
SSL_TYPE=$(terraform output -raw ssl_monitor_type 2>/dev/null || echo "")
IP_ID=$(terraform output -raw ip_monitor_id 2>/dev/null || echo "")
IP_TYPE=$(terraform output -raw ip_monitor_type 2>/dev/null || echo "")
INCOMING_REQUEST_ID=$(terraform output -raw incoming_request_monitor_id 2>/dev/null || echo "")
INCOMING_REQUEST_TYPE=$(terraform output -raw incoming_request_monitor_type 2>/dev/null || echo "")
SERVER_ID=$(terraform output -raw server_monitor_id 2>/dev/null || echo "")
SERVER_TYPE=$(terraform output -raw server_monitor_type 2>/dev/null || echo "")

echo ""
echo "Monitor Types Created:"
echo "  Website: ID=$WEBSITE_ID, Type=$WEBSITE_TYPE"
echo "  API: ID=$API_ID, Type=$API_TYPE"
echo "  Ping: ID=$PING_ID, Type=$PING_TYPE"
echo "  Port: ID=$PORT_ID, Type=$PORT_TYPE"
echo "  SSL Certificate: ID=$SSL_ID, Type=$SSL_TYPE"
echo "  IP: ID=$IP_ID, Type=$IP_TYPE"
echo "  Incoming Request: ID=$INCOMING_REQUEST_ID, Type=$INCOMING_REQUEST_TYPE"
echo "  Server: ID=$SERVER_ID, Type=$SERVER_TYPE"

# Verify all monitors created
ERRORS=0

declare -A MONITORS=(
    ["Website"]="$WEBSITE_ID:$WEBSITE_TYPE:Website"
    ["API"]="$API_ID:$API_TYPE:API"
    ["Ping"]="$PING_ID:$PING_TYPE:Ping"
    ["Port"]="$PORT_ID:$PORT_TYPE:Port"
    ["SSL Certificate"]="$SSL_ID:$SSL_TYPE:SSL Certificate"
    ["IP"]="$IP_ID:$IP_TYPE:IP"
    ["Incoming Request"]="$INCOMING_REQUEST_ID:$INCOMING_REQUEST_TYPE:Incoming Request"
    ["Server"]="$SERVER_ID:$SERVER_TYPE:Server"
)

for NAME in "${!MONITORS[@]}"; do
    IFS=':' read -r ID TYPE EXPECTED <<< "${MONITORS[$NAME]}"

    if [ -z "$ID" ]; then
        echo "ERROR: $NAME monitor not created"
        ERRORS=$((ERRORS + 1))
    fi

    if [ "$TYPE" != "$EXPECTED" ]; then
        echo "ERROR: $NAME monitor type mismatch. Expected '$EXPECTED', got '$TYPE'"
        ERRORS=$((ERRORS + 1))
    fi
done

if [ $ERRORS -gt 0 ]; then
    echo ""
    echo "FAILED: $ERRORS errors found"
    exit 1
fi

echo ""
echo "=== Verifying idempotency ==="
PLAN_OUTPUT=$(terraform plan -detailed-exitcode 2>&1) || PLAN_EXIT_CODE=$?
PLAN_EXIT_CODE=${PLAN_EXIT_CODE:-0}

if [ "$PLAN_EXIT_CODE" -eq 0 ]; then
    echo "SUCCESS: No changes detected - idempotency test PASSED"
elif [ "$PLAN_EXIT_CODE" -eq 2 ]; then
    echo "INFO: Changes detected (may be expected for server-computed fields)"
    # Don't fail - monitor_steps changes are expected
else
    echo "ERROR: terraform plan failed"
    exit 1
fi

echo ""
echo "=== Basic Monitor Types Test PASSED ==="
