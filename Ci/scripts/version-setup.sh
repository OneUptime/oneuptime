#!/usr/bin/env bash
echo "
This script changes version of every project
"
function version {
  cd $1
  npm version "5.0.$CI_PIPELINE_ID"
  cd ..
}

curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
sudo apt-get install -y nodejs

version dashboard
version accounts 
version backend
version home 
version StatusPage 
version ApiDocs
version probe
version AdminDashboard
version InitScript
version licensing
version HelmChart
version JavaScriptSDK
version oneuptime-le-store
version oneuptime-acme-http-01
version LighthouseRunner
version ScriptRunner
version ContainerScanner
version ApplicationScanner
version data-ingestor
version realtime
version ProbeAPI
version .