#!/usr/bin/env bash

set -e

if [[ ! $(which docker) && ! $(docker --version) ]]; then
  echo "Setting up Docker"
  sudo curl -sSL https://get.docker.com/ | sh  
fi


# If docker still fails to install, then quit. 
if [[ ! $(which docker) && ! $(docker --version) ]]; then
  echo -e "Failed to install docker. Please install Docker manually here: https://docs.docker.com/install."
  echo -e "Exiting the OneUptime installer."
  exit
fi


# enable docker without sudo
sudo usermod -aG docker "${USER}" || true

if [[ ! $(which docker-compose) && ! $(docker compose --version) ]]; then
    mkdir -p /usr/local/lib/docker/cli-plugins
    sudo curl -SL https://github.com/docker/compose/releases/download/v2.12.2/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/lib/docker/cli-plugins/docker-compose
    sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
    docker compose version
fi