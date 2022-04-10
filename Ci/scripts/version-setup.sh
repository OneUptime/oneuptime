#!/usr/bin/env bash
echo "
This script changes version of every project
"
function version {
  cd $1
  npm version "4.0.$CI_PIPELINE_ID"
  cd ..
}

curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
sudo apt-get install -y nodejs

version dashboard
version accounts 
version backend
version home 
version status-page 
version api-docs
version probe
version admin-dashboard
version init-script
version licensing
version helm-chart
version js-sdk
version oneuptime-le-store
version oneuptime-acme-http-01
version lighthouse-runner
version script-runner
version container-scanner
version application-scanner
version data-ingestor
version realtime
version probe-api
version .