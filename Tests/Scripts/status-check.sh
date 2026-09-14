#!/bin/bash

set -e

scriptDir=$(dirname -- "$(readlink -f -- "$BASH_SOURCE")")

HOST_TO_CHECK="$1"

if [ $# -eq 0 ]; then
    HOST_TO_CHECK="localhost"
fi

echo "We will need to wait ~5-10 minutes for things to settle down, migrations to finish, and TLS certs to be issued"
echo ""
echo "⏳ Waiting for OneUptime to boot (this will take a few minutes)"
echo ""
echo ""


bash $scriptDir/endpoint-status.sh "App" $HOST_TO_CHECK

bash $scriptDir/endpoint-status.sh "App (Status Check)" $HOST_TO_CHECK/status

bash $scriptDir/endpoint-status.sh "App (Ready Check)" $HOST_TO_CHECK/status/ready

bash $scriptDir/endpoint-status.sh "Dashboard" $HOST_TO_CHECK/dashboard

bash $scriptDir/endpoint-status.sh "Admin Dashboard" $HOST_TO_CHECK/admin/env.js

bash $scriptDir/endpoint-status.sh "Public Dashboard" $HOST_TO_CHECK/public-dashboard

bash $scriptDir/endpoint-status.sh "Accounts" $HOST_TO_CHECK/accounts

bash $scriptDir/endpoint-status.sh "Status Page" $HOST_TO_CHECK/status-page

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
echo "🎉🎉🎉  Done! 🎉🎉🎉"

echo "We would like to hear your feedback to make this product better for you and for other users, please email us at hello@oneuptime.com."
echo " - If you notice a bug, we will fix it for you."
echo " - If you need a feature, we will add that to the roadmap and let you know the estimated time to ship."
echo "- If you are an enterprise customer, we offer dedicated engineering support to build oneuptime features you need to integrate OneUptime for your organization. Please contact us at sales@oneuptime.com"
echo "We would love to hear your feedback. Email: hello@oneuptime.com"
