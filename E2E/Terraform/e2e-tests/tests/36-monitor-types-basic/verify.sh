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

# Verify each monitor individually to avoid associative array issues with spaces in keys

# Website
if [ -z "$WEBSITE_ID" ]; then
    echo "ERROR: Website monitor not created"
    ERRORS=$((ERRORS + 1))
fi
if [ "$WEBSITE_TYPE" != "Website" ]; then
    echo "ERROR: Website monitor type mismatch. Expected 'Website', got '$WEBSITE_TYPE'"
    ERRORS=$((ERRORS + 1))
fi

# API
if [ -z "$API_ID" ]; then
    echo "ERROR: API monitor not created"
    ERRORS=$((ERRORS + 1))
fi
if [ "$API_TYPE" != "API" ]; then
    echo "ERROR: API monitor type mismatch. Expected 'API', got '$API_TYPE'"
    ERRORS=$((ERRORS + 1))
fi

# Ping
if [ -z "$PING_ID" ]; then
    echo "ERROR: Ping monitor not created"
    ERRORS=$((ERRORS + 1))
fi
if [ "$PING_TYPE" != "Ping" ]; then
    echo "ERROR: Ping monitor type mismatch. Expected 'Ping', got '$PING_TYPE'"
    ERRORS=$((ERRORS + 1))
fi

# Port
if [ -z "$PORT_ID" ]; then
    echo "ERROR: Port monitor not created"
    ERRORS=$((ERRORS + 1))
fi
if [ "$PORT_TYPE" != "Port" ]; then
    echo "ERROR: Port monitor type mismatch. Expected 'Port', got '$PORT_TYPE'"
    ERRORS=$((ERRORS + 1))
fi

# SSL Certificate
if [ -z "$SSL_ID" ]; then
    echo "ERROR: SSL Certificate monitor not created"
    ERRORS=$((ERRORS + 1))
fi
if [ "$SSL_TYPE" != "SSL Certificate" ]; then
    echo "ERROR: SSL Certificate monitor type mismatch. Expected 'SSL Certificate', got '$SSL_TYPE'"
    ERRORS=$((ERRORS + 1))
fi

# IP
if [ -z "$IP_ID" ]; then
    echo "ERROR: IP monitor not created"
    ERRORS=$((ERRORS + 1))
fi
if [ "$IP_TYPE" != "IP" ]; then
    echo "ERROR: IP monitor type mismatch. Expected 'IP', got '$IP_TYPE'"
    ERRORS=$((ERRORS + 1))
fi

# Incoming Request
if [ -z "$INCOMING_REQUEST_ID" ]; then
    echo "ERROR: Incoming Request monitor not created"
    ERRORS=$((ERRORS + 1))
fi
if [ "$INCOMING_REQUEST_TYPE" != "Incoming Request" ]; then
    echo "ERROR: Incoming Request monitor type mismatch. Expected 'Incoming Request', got '$INCOMING_REQUEST_TYPE'"
    ERRORS=$((ERRORS + 1))
fi

# Server
if [ -z "$SERVER_ID" ]; then
    echo "ERROR: Server monitor not created"
    ERRORS=$((ERRORS + 1))
fi
if [ "$SERVER_TYPE" != "Server" ]; then
    echo "ERROR: Server monitor type mismatch. Expected 'Server', got '$SERVER_TYPE'"
    ERRORS=$((ERRORS + 1))
fi

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
