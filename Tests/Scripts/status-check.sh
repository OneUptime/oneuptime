#!/bin/bash

# Waits until OneUptime answers and holds ready, then says where to open it.
#
#   bash Tests/Scripts/status-check.sh            checks the ingress config.env
#                                                 publishes (ONEUPTIME_HTTP_PORT)
#   bash Tests/Scripts/status-check.sh <address>  checks that address instead,
#                                                 such as http://localhost
#
# `npm start` ends with it (`npm run status-check`). It used to check port 80
# of localhost whatever config.env said, so an install that moved the ingress
# (ONEUPTIME_HTTP_PORT=8080, because port 80 was taken) waited five minutes
# for nothing and ended with "Maximum retries reached" while OneUptime was
# running - and `npm start --services=...` handed it the list of services as
# the address to check.

set -e

scriptDir=$(dirname -- "$(readlink -f -- "${BASH_SOURCE[0]}")")

# A setting the way `npm start` reads it: config.env's last assignment of it,
# without surrounding whitespace, quotes or a carriage return, or else the
# environment's value. config.env comes first: some shells (zsh) set a HOST
# of their own.
read_setting() {
    local name="$1"
    local value=""
    local found="false"

    if [ -f ./config.env ]; then
        local line
        line=$(grep -E "^[[:space:]]*${name}[[:space:]]*=" ./config.env | tail -n 1 || true)
        if [ -n "$line" ]; then
            value="${line#*=}"
            found="true"
        fi
    fi

    if [ "$found" != "true" ]; then
        value="${!name-}"
    fi

    value="${value%$'\r'}"
    # Surrounding whitespace, then one pair of matching quotes.
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    if [ "${#value}" -ge 2 ]; then
        case "$value" in
            \"*\") value="${value:1:${#value}-2}" ;;
            \'*\') value="${value:1:${#value}-2}" ;;
        esac
    fi

    printf '%s' "$value"
}

# The address the ingress answers at on this server, from ONEUPTIME_HTTP_PORT
# as Compose publishes it: a port alone ("8080"), or an address and a port
# ("127.0.0.1:8080", "[::1]:8080"). Port 80 is left out of the address; an
# address that means every address of the server (0.0.0.0, ::) is localhost.
ingress_address() {
    local setting
    setting=$(read_setting ONEUPTIME_HTTP_PORT)

    local address="localhost"
    local port="$setting"

    case "$setting" in
        \[*\]:*)
            address="${setting%:*}"
            port="${setting##*:}"
            ;;
        *:*)
            address="${setting%:*}"
            port="${setting##*:}"
            ;;
    esac

    case "$address" in
        "" | "0.0.0.0" | "::" | "[::]") address="localhost" ;;
    esac

    if [ -z "$port" ] || [ "$port" = "80" ]; then
        printf '%s' "$address"
    else
        printf '%s:%s' "$address" "$port"
    fi
}

HOST_TO_CHECK="${1-}"

if [ -z "$HOST_TO_CHECK" ]; then
    HOST_TO_CHECK=$(ingress_address)
fi

echo "⏳ Waiting for OneUptime to answer at ${HOST_TO_CHECK}. The first start takes a few minutes: Docker downloads the images and OneUptime creates its databases."
echo ""


bash "$scriptDir/endpoint-status.sh" "App" "$HOST_TO_CHECK"

bash "$scriptDir/endpoint-status.sh" "App (Status Check)" "$HOST_TO_CHECK/status"

bash "$scriptDir/endpoint-status.sh" "App (Ready Check)" "$HOST_TO_CHECK/status/ready"

bash "$scriptDir/endpoint-status.sh" "Dashboard" "$HOST_TO_CHECK/dashboard"

bash "$scriptDir/endpoint-status.sh" "Admin Dashboard" "$HOST_TO_CHECK/admin/env.js"

bash "$scriptDir/endpoint-status.sh" "Public Dashboard" "$HOST_TO_CHECK/public-dashboard"

bash "$scriptDir/endpoint-status.sh" "Accounts" "$HOST_TO_CHECK/accounts"

bash "$scriptDir/endpoint-status.sh" "Status Page" "$HOST_TO_CHECK/status-page"

# Each check above stops at the first HTTP 200, which is a weaker claim than it
# looks: nginx serves the static bundles and answers /status/ready as soon as
# the backend accepts one connection, so a stack still settling can pass every
# check above in well under a second. It has - the run that gated 12.0.29
# cleared all eight in 94ms and then handed a half-warm backend to a suite
# whose first test gives up after four minutes.
#
# So require the readiness endpoint to hold, not just answer once. A backend
# still finishing its boot flaps; one that is genuinely ready returns 200 every
# time. Consecutive successes are what separates the two, and the counter
# resets on any non-200 so a flapping backend can never accumulate a pass.
REQUIRED_CONSECUTIVE_OK=5
STABILITY_INTERVAL=5
MAX_STABILITY_ATTEMPTS=60

echo ""
echo "⏳ Confirming the backend stays ready (need ${REQUIRED_CONSECUTIVE_OK} consecutive checks)"

consecutive_ok=0
attempts=0

while [ "$consecutive_ok" -lt "$REQUIRED_CONSECUTIVE_OK" ]; do
    if [ "$attempts" -ge "$MAX_STABILITY_ATTEMPTS" ]; then
        echo "❌ Error: backend never stayed ready for ${REQUIRED_CONSECUTIVE_OK} checks in a row."
        echo "   It answered at least once, so this is a backend that is flapping rather than one that is down."
        exit 1
    fi

    attempts=$((attempts + 1))

    # `|| true` so a connection failure is a non-200 to handle, not a `set -e` abort.
    status=$(curl -s -o /dev/null -w "%{http_code}" -L "$HOST_TO_CHECK/status/ready" || true)

    if [ "$status" = "200" ]; then
        consecutive_ok=$((consecutive_ok + 1))
        echo "   ✅ ready ${consecutive_ok}/${REQUIRED_CONSECUTIVE_OK}"
    else
        # Reset, not decrement: five in a row must mean five in a row.
        if [ "$consecutive_ok" -gt 0 ]; then
            echo "   ↺ backend returned HTTP ${status} after ${consecutive_ok} good check(s) - starting the count again"
        else
            echo "   … backend returned HTTP ${status}, waiting"
        fi
        consecutive_ok=0
    fi

    if [ "$consecutive_ok" -lt "$REQUIRED_CONSECUTIVE_OK" ]; then
        sleep "$STABILITY_INTERVAL"
    fi
done

echo "✅ Backend held ready across ${REQUIRED_CONSECUTIVE_OK} consecutive checks"
echo ""

echo "🚀 OneUptime is up! 🚀"
echo ""

# Where people open it: HOST, over HTTP_PROTOCOL, as every link OneUptime
# builds. The first account a new install's sign-up page creates is its admin.
OPEN_HOST=$(read_setting HOST)
OPEN_PROTOCOL=$(read_setting HTTP_PROTOCOL)

if [ "$OPEN_PROTOCOL" != "https" ]; then
    OPEN_PROTOCOL="http"
fi

if [ -n "$OPEN_HOST" ]; then
    echo "Open ${OPEN_PROTOCOL}://${OPEN_HOST} in your browser. On a new install, sign up at ${OPEN_PROTOCOL}://${OPEN_HOST}/accounts/register: the first account becomes the admin of this OneUptime."

    case "$OPEN_HOST" in
        localhost | localhost:* | 127.0.0.1 | 127.0.0.1:*)
            echo "Only this computer can open ${OPEN_PROTOCOL}://${OPEN_HOST}. To open OneUptime from other computers, set HOST in config.env to this server's domain name or IP address, then run npm start again."
            ;;
    esac

    echo ""
fi

echo "Questions or feedback? Email hello@oneuptime.com. Running OneUptime for your organization? Ask sales@oneuptime.com about priority support."
