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
#
# Then it checked the address the ingress is published on by that address:
# with ONEUPTIME_HTTP_PORT=127.0.0.1:8080, the setting the Docker Compose
# guide gives an install behind a reverse proxy of its own, it asked for
# http://127.0.0.1:8080. The ingress serves OneUptime only under the names
# localhost, ingress and HOST (the primary server in Nginx/default.conf.template,
# and the app's own list of its names); any other name, an IP address
# included, is a status page's custom domain, which answers 404 at /,
# /dashboard, /accounts and /admin. So `npm start` and `npm run update` waited
# five minutes and ended with "Maximum retries reached" while OneUptime was up,
# and never ran the doctor (#10024). The same for [::1]:8080 and for an address
# of the server's own, such as 10.0.0.5:8080.
#
# Now it connects where the ingress is published, and asks it for localhost:
# curl's --resolve has the request for localhost:8080 connect to 127.0.0.1,
# so the ingress reads the Host header localhost:8080, as from a browser on
# this server. An address given on the command line is checked as it is given.

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

# Where the ingress is published on this server, from ONEUPTIME_HTTP_PORT as
# Compose publishes it: a port alone ("8080"), or an address and a port
# ("127.0.0.1:8080", "[::1]:8080", "::1:8080", "10.0.0.5:8080"). Like Compose,
# it takes what follows the last ":" for the port, and what comes before it,
# without brackets, for the address. Sets INGRESS_ADDRESS, the address to
# connect to, an IPv6 address in brackets - localhost for none, which Docker
# publishes on every address, and for 0.0.0.0, every IPv4 address; [::1] for
# ::, which Docker publishes on IPv6 alone - and INGRESS_PORT, 80 when the
# setting names none. Scripts/Install/FollowIngressPort.js reads it the same
# way (publishedIngressOf, connectableAddressOf).
read_ingress() {
    local setting
    setting=$(read_setting ONEUPTIME_HTTP_PORT)

    INGRESS_ADDRESS=""
    INGRESS_PORT="$setting"

    case "$setting" in
        *:*)
            INGRESS_ADDRESS="${setting%:*}"
            INGRESS_PORT="${setting##*:}"
            ;;
    esac

    INGRESS_ADDRESS="${INGRESS_ADDRESS#\[}"
    INGRESS_ADDRESS="${INGRESS_ADDRESS%\]}"

    case "$INGRESS_ADDRESS" in
        "" | "0.0.0.0") INGRESS_ADDRESS="localhost" ;;
        "::") INGRESS_ADDRESS="[::1]" ;;
        *:*) INGRESS_ADDRESS="[${INGRESS_ADDRESS}]" ;;
    esac

    if [ -z "$INGRESS_PORT" ]; then
        INGRESS_PORT="80"
    fi
}

# An address and a port as a web address writes them: without the port when it is 80.
with_port() {
    if [ "$2" = "80" ]; then
        printf '%s' "$1"
    else
        printf '%s:%s' "$1" "$2"
    fi
}

HOST_TO_CHECK="${1-}"

# curl's --resolve for every request of the check, when the ingress is
# published on one address of this server: "localhost:8080:127.0.0.1" has the
# request for localhost:8080 connect to 127.0.0.1, with the Host header
# localhost:8080. --resolve, which every curl since 7.21 has (--connect-to
# came in 7.49), with an IPv6 address without its brackets, as every one of
# them reads it. CHECKED_AT is where it connects, as a web address writes it.
RESOLVE=""
CHECKED_AT=""
CURL_TARGET=()
WAITING_AT=""

if [ -z "$HOST_TO_CHECK" ]; then
    read_ingress

    # The name the ingress serves OneUptime under, with the ingress's port.
    HOST_TO_CHECK=$(with_port localhost "$INGRESS_PORT")
    WAITING_AT="$HOST_TO_CHECK"

    if [ "$INGRESS_ADDRESS" != "localhost" ]; then
        resolved_address="${INGRESS_ADDRESS#\[}"
        resolved_address="${resolved_address%\]}"
        RESOLVE="localhost:${INGRESS_PORT}:${resolved_address}"
        CURL_TARGET=(--resolve "$RESOLVE")
        CHECKED_AT=$(with_port "$INGRESS_ADDRESS" "$INGRESS_PORT")
        WAITING_AT="${CHECKED_AT}, where ONEUPTIME_HTTP_PORT publishes the ingress"
    fi
else
    WAITING_AT="$HOST_TO_CHECK"
fi

echo "⏳ Waiting for OneUptime to answer at ${WAITING_AT}. The first start takes a few minutes, while OneUptime sets up its databases."
echo ""


bash "$scriptDir/endpoint-status.sh" "App" "$HOST_TO_CHECK" "$RESOLVE" "$CHECKED_AT"

bash "$scriptDir/endpoint-status.sh" "App (Status Check)" "$HOST_TO_CHECK/status" "$RESOLVE" "$CHECKED_AT"

bash "$scriptDir/endpoint-status.sh" "App (Ready Check)" "$HOST_TO_CHECK/status/ready" "$RESOLVE" "$CHECKED_AT"

bash "$scriptDir/endpoint-status.sh" "Dashboard" "$HOST_TO_CHECK/dashboard" "$RESOLVE" "$CHECKED_AT"

bash "$scriptDir/endpoint-status.sh" "Admin Dashboard" "$HOST_TO_CHECK/admin/env.js" "$RESOLVE" "$CHECKED_AT"

bash "$scriptDir/endpoint-status.sh" "Public Dashboard" "$HOST_TO_CHECK/public-dashboard" "$RESOLVE" "$CHECKED_AT"

bash "$scriptDir/endpoint-status.sh" "Accounts" "$HOST_TO_CHECK/accounts" "$RESOLVE" "$CHECKED_AT"

# With the slash: when billing is enabled the bare /status-page is the
# marketing site's address for /product/status-page, and only /status-page/...
# reaches the status page app.
bash "$scriptDir/endpoint-status.sh" "Status Page" "$HOST_TO_CHECK/status-page/" "$RESOLVE" "$CHECKED_AT"

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
    status=$(curl -s -o /dev/null -w "%{http_code}" -L "${CURL_TARGET[@]}" "$HOST_TO_CHECK/status/ready" || true)

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
    # The server's setup checklist: email, HTTPS, sign-ups and the rest (#6824).
    echo "Then finish setting up this server: ${OPEN_PROTOCOL}://${OPEN_HOST}/admin/setup"

    # This computer's names, IPv6's in brackets as HOST writes it ([::1]:8080).
    case "$OPEN_HOST" in
        localhost | localhost:* | 127.0.0.1 | 127.0.0.1:* | \[::1\] | \[::1\]:*)
            echo "Only this computer can open ${OPEN_PROTOCOL}://${OPEN_HOST}. To open OneUptime from other computers, set HOST in config.env to this server's domain name or IP address, then run npm start again."
            ;;
    esac

    echo ""
fi

echo "Questions or feedback? Email hello@oneuptime.com. Running OneUptime for your organization? Ask sales@oneuptime.com about priority support."
