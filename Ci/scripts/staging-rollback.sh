#!/usr/bin/env bash
echo "
This script rollbacks every project if any of the deployment fails
"

chmod +x ./ci/scripts/job-status.sh

function rollback {
  export status=`./ci/scripts/job-status.sh staging_$1`
  if [[ $status == \"success\" ]]
    then
        echo "Rolling back $1"
        sudo kubectl rollout undo deployment/fi-$1
        if [[ $1 == \"probe\" ]]
          then
          echo "Rolling back probe1"
          sudo kubectl rollout undo deployment/fi-probe1
          sudo kubectl rollout undo deployment/fi-probe2
        fi
    else
        echo "Rollback skipped $1"
  fi
}

function check {
  export status=`./ci/scripts/job-status.sh staging_$1`
  if [[ $status == \"failed\" ]]
    then
        echo "Deployment unsuccessful for $1, rolling back all new deployments"
        rollback dashboard
        rollback accounts 
        rollback backend
        rollback home
        rollback StatusPage 
        rollback ApiDocs
        rollback probe
        rollback AdminDashboard
        rollback licensing
        rollback HelmChart
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
check StatusPage 
check ApiDocs
check probe-1
check probe-2
check AdminDashboard
check licensing
check slack
check HelmChart