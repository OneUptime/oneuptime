#!/bin/bash

# Waits up to five minutes for one of OneUptime's addresses to answer HTTP 200.
#
#   bash Tests/Scripts/endpoint-status.sh <name> <address> [<connect-to>]
#
# <connect-to>, when it is given, is curl's --connect-to: with
# "localhost:8080:127.0.0.1:8080" the request for localhost:8080 goes to
# 127.0.0.1:8080, the address the ingress is published on. status-check.sh
# says why.

# Set the endpoint URL
endpoint_url=$2
name=$1
connect_to=${3-}

# if name or endpoint is not provided, exit
if [ $# -eq 0 ]; then
    echo "❌ Error: Please provide a name and endpoint URL"
    exit 1
fi

curl_target=()
# The address it connects to, as a web address writes it: 127.0.0.1:8080,
# [::1]:8080, or 127.0.0.1 for port 80.
connected_to=""
where="$endpoint_url"

if [ -n "$connect_to" ]; then
    curl_target=(--connect-to "$connect_to")
    connected_to="${connect_to#*:*:}"
    connected_to="${connected_to%:80}"
    where="$endpoint_url at $connected_to"
fi

# 20 attempts, 15 seconds apart: five minutes for this endpoint to answer.
max_retries=20
retry_interval=15  # Retry interval in seconds

# Initialize variables
retries=0
http_status=0

# Loop until either the endpoint returns 200 or the maximum retries are reached
while [ $retries -lt $max_retries ]; do
    # Make a curl request and capture the HTTP status code, following redirects
    http_status=$(curl -s -o /dev/null -w "%{http_code}" -L "${curl_target[@]}" "$endpoint_url")

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
    if [ -n "$connected_to" ]; then
        echo "   Nothing answered at $connected_to, where ONEUPTIME_HTTP_PORT in config.env publishes OneUptime's ingress."
    else
        echo "   Nothing answered at $endpoint_url. If OneUptime's ingress is on another port, check that one: bash Tests/Scripts/status-check.sh localhost:<port>"
    fi
fi
echo "   See what is running with npm run ps, and why something stopped with npm run logs."
exit 1  # Exit the script with an error status
