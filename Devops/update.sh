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
    kubectl set image $1 $2
}

# $1 - image tag
update deployment/fi-accounts fi-accounts=oneuptime/accounts:$1
update deployment/fi-dashboard fi-dashboard=oneuptime/dashboard:$1
update deployment/fi-admin fi-admin=oneuptime/AdminDashboard:$1
update deployment/fi-ApiReference fi-ApiReference=oneuptime/ApiReference:$1
update deployment/fi-app-scan fi-app-scan=oneuptime/ApplicationScanner:$1
update deployment/fi-backend fi-backend=oneuptime/backend:$1
update deployment/fi-cont-scan fi-cont-scan=oneuptime/ContainerScanner:$1
update deployment/fi-ingestor fi-ingestor=oneuptime/data-ingestor:$1
update deployment/fi-haraka fi-haraka=oneuptime/haraka:$1
update deployment/fi-HelmChart fi-HelmChart=oneuptime/HelmChart:$1
update deployment/fi-home fi-home=oneuptime/home:$1
update deployment/fi-test fi-test=oneuptime/HttpTestServer:$1
update deployment/fi-licensing fi-licensing=oneuptime/licensing:$1
update deployment/fi-lighthouse fi-lighthouse=oneuptime/LighthouseRunner:$1
update deployment/fi-probe1 fi-probe1=oneuptime/probe:$1
update deployment/fi-probe2 fi-probe2=oneuptime/probe:$1
update deployment/fi-realtime fi-realtime=oneuptime/realtime:$1
update deployment/fi-script fi-script=oneuptime/ScriptRunner:$1
update deployment/fi-status fi-status=oneuptime/StatusPage:$1