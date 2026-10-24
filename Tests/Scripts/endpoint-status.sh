#!/bin/bash

# Set the endpoint URL
endpoint_url=$2
name=$1

# if name or endpoint is not provided, exit
if [ $# -eq 0 ]; then
    echo "❌ Error: Please provide a name and endpoint URL"
    exit 1
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
    http_status=$(curl -s -o /dev/null -w "%{http_code}" -L $endpoint_url)

    # Check if the HTTP status code is 200 (OK)
    if [ $http_status -eq 200 ]; then
        echo "✅ $name endpoint is up ($endpoint_url)"
        exit 0  # Exit the script with success status
    else
        echo "$name $endpoint_url returned HTTP $http_status, retrying in $retry_interval seconds. The first start usually takes a few minutes."
        sleep $retry_interval
        retries=$((retries + 1))
    fi
done

# If the loop exits without getting HTTP 200, throw an error
echo "❌ Error: Maximum retries reached, $name still not returning HTTP 200. It could be down or taking longer than expected to start."
if [ "$http_status" = "000" ]; then
    echo "   Nothing answered at $endpoint_url. If OneUptime's ingress is on another port, check that one: bash Tests/Scripts/status-check.sh localhost:<port>"
fi
echo "   See what is running with npm run ps, and why something stopped with npm run logs."
exit 1  # Exit the script with an error status
