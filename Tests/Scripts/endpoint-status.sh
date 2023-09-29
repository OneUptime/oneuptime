#!/bin/bash

# Set the endpoint URL
endpoint_url=$2
name=$1

# if name or endpoint is not provided, exit
if [ $# -eq 0 ]; then
    echo "❌ Error: Please provide a name and endpoint URL"
    exit 1
fi

# Set the maximum number of retries
max_retries=20  # This allows for 12 attempts, which totals 1 minute with 5 seconds between each retry
retry_interval=5  # Retry interval in seconds

# Initialize variables
retries=0
http_status=0

# Loop until either the endpoint returns 200 or the maximum retries are reached
while [ $retries -lt $max_retries ]; do
    # Make a curl request and capture the HTTP status code
    http_status=$(curl -s -o /dev/null -w "%{http_code}" $endpoint_url)
    
    # Check if the HTTP status code is 200 (OK)
    if [ $http_status -eq 200 ]; then
        echo "✅ $name endpoint is up ($endpoint_url)"
        exit 0  # Exit the script with success status
    else
        echo "$name $endpoint_url returned HTTP $http_status, retrying in $retry_interval seconds..."
        sleep $retry_interval
        retries=$((retries + 1))
    fi
done

# If the loop exits without getting HTTP 200, throw an error
echo "❌ Error: Maximum retries reached, $name still not returning HTTP 200. It could be down or taking longer than expected to start."
exit 1  # Exit the script with an error status
