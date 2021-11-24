#!/usr/bin/env bash

# Please make sure kubectl is installed and context is pointed to the cluster you want to update/rollback.
if [[ ! $(which kubectl)]]
then
  echo -e "\033[91mPlease install Kubectl and point context to the cluster you want to update/rollback. https://kubernetes.io/docs/tasks/tools/install-kubectl-linux/"
  exit
fi

function update {
    # $1 - target deployment
    # $2 - target image
    echo "Updating $1 with $2"
    sudo kubectl set image $1 $2
}

# $1 - image tag
update deployment/fi-accounts fi-accounts=oneuptimeproject/accounts:$1
update deployment/fi-dashboard fi-dashboard=oneuptimeproject/dashboard:$1
update deployment/fi-admin fi-admin=oneuptimeproject/admin-dashboard:$1
update deployment/fi-api-docs fi-api-docs=oneuptimeproject/api-docs:$1
update deployment/fi-app-scan fi-app-scan=oneuptimeproject/application-scanner:$1
update deployment/fi-backend fi-backend=oneuptimeproject/backend:$1
update deployment/fi-cont-scan fi-cont-scan=oneuptimeproject/container-scanner:$1
update deployment/fi-ingestor fi-ingestor=oneuptimeproject/data-ingestor:$1
update deployment/fi-haraka fi-haraka=oneuptimeproject/haraka:$1
update deployment/fi-helm-chart fi-helm-chart=oneuptimeproject/helm-chart:$1
update deployment/fi-home fi-home=oneuptimeproject/home:$1
update deployment/fi-test fi-test=oneuptimeproject/http-test-server:$1
update deployment/fi-licensing fi-licensing=oneuptimeproject/licensing:$1
update deployment/fi-lighthouse fi-lighthouse=oneuptimeproject/lighthouse-runner:$1
update deployment/fi-probe1 fi-probe1=oneuptimeproject/probe:$1
update deployment/fi-probe2 fi-probe2=oneuptimeproject/probe:$1
update deployment/fi-realtime fi-realtime=oneuptimeproject/realtime:$1
update deployment/fi-script fi-script=oneuptimeproject/script-runner:$1
update deployment/fi-status fi-status=oneuptimeproject/status-page:$1