#!/usr/bin/env bash
echo "
This script rollbacks every project if any of the deployment fails
"

chmod +x ./ci/scripts/job-status.sh

function rollback {
  export status=`./ci/scripts/job-status.sh deploy_staging_$1`
  if [[ $status == \"success\" ]]
    then
        echo "Rolling back $1"
        sudo $HOME/google-cloud-sdk/bin/kubectl rollout undo deployment/$1
        if [[ $1 == \"probe\" ]]
          then
          echo "Rolling back probe1"
          sudo $HOME/google-cloud-sdk/bin/kubectl rollout undo deployment/probe1
        fi
    else
        echo "Rollback skipped $1"
  fi
}

function check {
  export status=`./ci/scripts/job-status.sh deploy_staging_$1`
  if [[ $status == \"failed\" ]]
    then
        echo "Deployment unsuccessful for $1, rolling back all new deployments"
        rollback dashboard
        rollback accounts 
        rollback backend
        rollback home
        rollback status-page 
        rollback api-docs
        rollback probe
        rollback admin-dashboard
        rollback licensing
        rollback helm-chart
        rollback slack
        exit 1
    else
        echo "$1 Deployment successful"
  fi
}

check dashboard
check accounts 
check backend
check home 
check status-page 
check api-docs
check probe-1
check probe-2
check admin-dashboard
check server-monitor
check licensing
check slack
check helm-chart