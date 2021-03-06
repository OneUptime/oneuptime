#!/usr/bin/env bash
echo "
This script changes version of every project
"

function version {
  cd $1
  npm version "3.0.2" || echo "Not a node project. Unable to version $1"
  cd ..
}

# curl -sL https://deb.nodesource.com/setup_12.x | sudo -E bash -
# sudo apt-get install -y nodejs

# Version root. 
version .

for entry in "$(ls .)"
do
  # Version subprojects. 
  version "$entry"
done

# version dashboard
# version accounts 
# version backend
# version home 
# version status-page 
# version api-docs
# version server-monitor
# version probe
# version admin-dashboard
# version init-script
# version licensing
# version helm-chart
# version js-sdk
# version .