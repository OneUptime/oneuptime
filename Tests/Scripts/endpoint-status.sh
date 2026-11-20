#!/bin/bash

# Waits up to five minutes for one of OneUptime's addresses to answer HTTP 200.
#
#   bash Tests/Scripts/endpoint-status.sh <name> <address> [<resolve> <shown as> [<setting>]]
#
# <resolve>, when it is given, is curl's --resolve: with
# "localhost:8080:127.0.0.1" the request for localhost:8080 connects to
# 127.0.0.1, the address the ingress is published on, and <shown as> is that
# address as a web address writes it (127.0.0.1:8080, [::1]:8080), for what
# this says. <setting> is the setting of config.env that publishes it there,
# ONEUPTIME_HTTP_PORT unless it names another. status-check.sh says why.
#
# An https address asked with <resolve> takes any certificate (-k): it is
# HOST asked of the ingress on this server, which serves a temporary
# self-signed certificate until Let's Encrypt issues HOST's, and the doctor
# checks the certificate itself. One asked without it, such as the Helm
# chart's test pod's https://<host>, must present a certificate curl trusts.
#
# ENDPOINT_STATUS_RETRIES sets how many times it asks, 15 seconds apart: 20
# unless it says otherwise.

# Set the endpoint URL
endpoint_url=$2
name=$1
resolve=${3-}
connected_to=${4-}
setting=${5:-ONEUPTIME_HTTP_PORT}

# if name or endpoint is not provided, exit
if [ $# -eq 0 ]; then
    echo "❌ Error: Please provide a name and endpoint URL"
    exit 1
fi

curl_target=()
where="$endpoint_url"

if [ -n "$resolve" ]; then
    curl_target=(--resolve "$resolve")

    case "$endpoint_url" in
        https://*) curl_target+=(-k) ;;
    esac

    if [ -n "$connected_to" ]; then
        where="$endpoint_url at $connected_to"
    fi
fi

# 20 attempts, 15 seconds apart: five minutes for this endpoint to answer,
# unless ENDPOINT_STATUS_RETRIES names another number of attempts.
max_retries=${ENDPOINT_STATUS_RETRIES:-20}
case "$max_retries" in
    "" | *[!0-9]*) max_retries=20 ;;
esac
retry_interval=15  # Retry interval in seconds

# Initialize variables
retries=0
http_status=0
curl_status=0

# Loop until either the endpoint returns 200 or the maximum retries are reached
while [ $retries -lt "$max_retries" ]; do
    # Make a curl request and capture the HTTP status code, following redirects
    http_status=$(curl -s -o /dev/null -w "%{http_code}" -L "${curl_target[@]}" "$endpoint_url")
    curl_status=$?

    # Check if the HTTP status code is 200 (OK)
    if [ "$http_status" = "200" ]; then
        echo "✅ $name endpoint is up ($where)"
        exit 0  # Exit the script with success status
    else
        echo "$name $where returned HTTP $http_status, retrying in $retry_interval seconds. The first start usually takes a few minutes."
        sleep $retry_interval
        retries=$((retries + 1))
    fi
done

# If the loop exits without getting HTTP 200, throw an error
echo "❌ Error: Maximum retries reached, $name still not returning HTTP 200. It could be down or taking longer than expected to start."
if [ "$http_status" = "000" ]; then
    if [ -n "$connected_to" ] && [ "$curl_status" = "35" ]; then
        # curl's 35: the TLS handshake failed. Something answers there, but
        # not as HTTPS for the name asked: a plain-HTTP port, or an ingress
        # that serves no HTTPS for HOST.
        tls_name="${endpoint_url#*://}"
        tls_name="${tls_name%%/*}"
        tls_name="${tls_name%:*}"
        echo "   Something answers at $connected_to, where $setting in config.env publishes OneUptime's ingress, but it completed no TLS handshake for $tls_name. The ingress's log says why: npm run logs --services=ingress"
    elif [ -n "$connected_to" ]; then
        echo "   Nothing answered at $connected_to, where $setting in config.env publishes OneUptime's ingress."
    else
        echo "   Nothing answered at $endpoint_url. If OneUptime's ingress is on another port, check that one: bash Tests/Scripts/status-check.sh localhost:<port>"
    fi
fi
echo "   See what is running with npm run ps, and why something stopped with npm run logs."
exit 1  # Exit the script with an error status
