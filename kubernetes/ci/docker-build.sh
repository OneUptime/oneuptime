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
FYIPE_DIR="$DIR/.."

function build {
  cd $1
  sudo docker build -t localhost:32000/$1:master .
  sudo docker push localhost:32000/$1
  cd ..
}

cd ..

build fyipe
build accounts 
build backend
build home 
build status-page 
build api-docs

cd $DIR