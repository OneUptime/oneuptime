#!/usr/bin/env bash

# Install Kubectl
curl -LO "https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
sudo kubectl version --client

# Auth with DigitalOcean Client
# echo "Install doctl"
# sudo snap install doctl
# sudo snap connect doctl:kube-config
# sudo snap connect doctl:ssh-keys :ssh-keys
# sudo snap connect doctl:dot-docker

# Install and configure aws cli
sudo apt-get install -y unzip
curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" # download latest aws cli version
unzip awscliv2.zip
sudo ./aws/install
aws --version # confirm installation

# Make .config folder
sudo mkdir /root/.config || echo "Directory already created."
sudo mkdir /root/.kube || echo "Directory already created."

#Init auth
# echo "Auth doctl"
# sudo doctl auth init -t $DIGITALOCEAN_TOKEN
