#!/bin/bash

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

bash $scriptDir/endpoint-status.sh "Root" $HOST_TO_CHECK/

bash $scriptDir/endpoint-status.sh "Home" $HOST_TO_CHECK/status

bash $scriptDir/endpoint-status.sh "API" $HOST_TO_CHECK/api/status

bash $scriptDir/endpoint-status.sh "Dashboard" $HOST_TO_CHECK/dashboard/status

bash $scriptDir/endpoint-status.sh "File" $HOST_TO_CHECK/file/status

bash $scriptDir/endpoint-status.sh "Status Page" $HOST_TO_CHECK/status-page/status

bash $scriptDir/endpoint-status.sh "Accounts" $HOST_TO_CHECK/accounts/status

bash $scriptDir/endpoint-status.sh "Notification" $HOST_TO_CHECK/notification/status

bash $scriptDir/endpoint-status.sh "Worker" $HOST_TO_CHECK/workers/status

bash $scriptDir/endpoint-status.sh "Identity" $HOST_TO_CHECK/identity/status

bash $scriptDir/endpoint-status.sh "Workflow" $HOST_TO_CHECK/workflow/status

bash $scriptDir/endpoint-status.sh "API Docs" $HOST_TO_CHECK/reference/status

bash $scriptDir/endpoint-status.sh "Link Shortener" $HOST_TO_CHECK/l/status

bash $scriptDir/endpoint-status.sh "Admin Dashboard" $HOST_TO_CHECK/admin/status

bash $scriptDir/endpoint-status.sh "Ingestor" $HOST_TO_CHECK/ingestor/status

echo "🚀 OneUptime is up! 🚀"
echo ""
echo "🎉🎉🎉  Done! 🎉🎉🎉"

echo "We would like to hear your feedback to make this product better for you and for other users, please email us at hello@oneuptime.com."
echo " - If you notice a bug, we will fix it for you."
echo " - If you need a feature, we will add that to the roadmap and let you know the estimated time to ship."
echo "- If you are an enterprise customer, we offer dedicated engineering support to build oneuptime features you need to integrate OneUptime for your organization. Please contact us at sales@oneuptime.com"
echo "We would love to hear your feedback. Email: hello@oneuptime.com"