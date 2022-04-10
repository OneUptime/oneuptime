#!/usr/bin/env bash

echo "
======== IMPORTANT! =========
This script will take ~30+ mins to complete.
- Builds a docker container
- This scirpt takes a long time to run when you run it for the first time
- Next subsequent executions would be a lot faster.
"

if [[ ! $(which docker) && ! $(docker  --version) ]]
then
  echo -e "\033[91mPlease install Docker. https://docs.docker.com/install"
  exit
fi

if [[ ! $(which git) && ! $(docker --git) ]]
then
  echo -e "\033[91mPlease install Git. https://git-scm.com/book/en/v2/Getting-Started-Installing-Git"
  exit
fi

DIR=$PWD
ONEUPTIME_DIR="$DIR/.."

chmod +x ./ci/scripts/docker-build-and-push.sh
function build {
  ./ci/scripts/docker-build-and-push.sh $1 $2
}

# cd ..

build dashboard $1
build accounts $1 
build backend $1
build home $1
build status-page $1
build api-docs $1
build probe $1
build admin-dashboard $1
build init-script $1
build slack $1
build licensing $1
build helm-chart $1
build lighthouse-runner $1
build script-runner $1
build container-scanner $1
build application-scanner $1
build data-ingestor $1
build realtime $1
build haraka $1
build http-test-server $1

cd $DIR