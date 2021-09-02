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
update deployment/fi-accounts fi-accounts=fyipeproject/accounts:$1
update deployment/fi-dashboard fi-dashboard=fyipeproject/dashboard:$1
update deployment/fi-admin fi-admin=fyipeproject/admin-dashboard:$1
update deployment/fi-api-docs fi-api-docs=fyipeproject/api-docs:$1
update deployment/fi-app-scan fi-app-scan=fyipeproject/application-scanner:$1
update deployment/fi-backend fi-backend=fyipeproject/backend:$1
update deployment/fi-cont-scan fi-cont-scan=fyipeproject/container-scanner:$1
update deployment/fi-ingestor fi-ingestor=fyipeproject/data-ingestor:$1
update deployment/fi-haraka fi-haraka=fyipeproject/haraka:$1
update deployment/fi-helm-chart fi-helm-chart=fyipeproject/helm-chart:$1
update deployment/fi-home fi-home=fyipeproject/home:$1
update deployment/fi-test fi-test=fyipeproject/http-test-server:$1
update deployment/fi-licensing fi-licensing=fyipeproject/licensing:$1
update deployment/fi-lighthouse fi-lighthouse=fyipeproject/lighthouse-runner:$1
update deployment/fi-probe1 fi-probe1=fyipeproject/probe:$1
update deployment/fi-probe2 fi-probe2=fyipeproject/probe:$1
update deployment/fi-realtime fi-realtime=fyipeproject/realtime:$1
update deployment/fi-script fi-script=fyipeproject/script-runner:$1
update deployment/fi-status fi-status=fyipeproject/status-page:$1