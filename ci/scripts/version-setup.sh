#!/usr/bin/env bash
echo "
This script changes version of every project
"
function version {
  ls 
  cd $1
  npm version "3.0.$CI_PIPELINE_IID"
  cd ..
}

curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
sudo apt-get install -y nodejs

# version dashboard
# version accounts 
# version backend
# version home 
# version status-page 
# version api-docs
# version server-monitor
# version probe
# version admin-dashboard
# version slack
# version init-script
# version licensing
# version helm-chart
version log-js
# version .