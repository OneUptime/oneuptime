#!/bin/bash

# Install Kubectl
OS_ARCHITECTURE="amd64"
if [[ "$(uname -m)" -eq "aarch64" ]] ; then OS_ARCHITECTURE="arm64" ; fi
if [[ "$(uname -m)" -eq "arm64" ]] ; then OS_ARCHITECTURE="arm64" ; fi
curl -LO "https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/$(OS_ARCHITECTURE)/kubectl"
sudo chmod +x ./kubectl
sudo mv ./kubectl /usr/local/bin/kubectl
sudo kubectl version --client
# Auth with DigitalOcean Client
echo "Install doctl"
sudo snap install doctl
sudo snap connect doctl:kube-config
sudo snap connect doctl:ssh-keys :ssh-keys
sudo snap connect doctl:dot-docker
# Make .config folder
sudo mkdir /root/.config || echo "Directory already created."
sudo mkdir /root/.kube || echo "Directory already created."
#Init auth
echo "Auth doctl"
sudo doctl auth init -t $DIGITALOCEAN_TOKEN
