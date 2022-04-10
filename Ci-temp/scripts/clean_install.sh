#!/usr/bin/env bash
echo "
This script npm install's the every project
"
function clean_install {
  echo "Installing $1"
  cd $1
  rm package-lock.json
  rm -rf node_modules
  npm install
  npm audit fix
  cd ..
  echo "Complete $1"
  echo ""
}

clean_install dashboard
clean_install accounts 
clean_install backend
clean_install home 
clean_install status-page 
clean_install api-docs
clean_install probe
clean_install admin-dashboard
clean_install init-script
clean_install licensing
clean_install helm-chart
clean_install js-sdk
clean_install .