#!/usr/bin/env bash

# Install Kubectl
curl -LO "https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl
sudo kubectl version --client

# fix dpkg interruption
sudo dpkg --configure -a

# fix broken unmet dependencies
sudo apt --fix-broken install -y -y

# # Install and configure aws cli
# sudo apt-get install -y unzip
# curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip" # download latest aws cli version
# unzip awscliv2.zip
# sudo ./aws/install
# aws --version # confirm installation

# # Remove any already existing ~/.aws, /root/.kube or /root/.config directory
# sudo rm -rf ~/.aws || echo "Directory already deleted"
# sudo rm -rf /root/.config || echo "Directory already deleted"
# sudo rm -rf /root/.kube || echo "Directory already deleted"

# # Configure aws cli
# sudo aws configure set aws_access_key_id $AWS_ACCESS_KEY_ID
# sudo aws configure set aws_secret_access_key $AWS_SECRET_ACCESS_KEY
# sudo aws configure set default.region $AWS_DEFAULT_REGION
# sudo aws configure set default.output json


# Install doctl.
wget https://github.com/digitalocean/doctl/releases/download/v1.71.0/doctl-1.71.0-linux-amd64.tar.gz
tar xf doctl-1.71.0-linux-amd64.tar.gz
sudo mv doctl /usr/local/bin

# Setup access token
doctl auth init --access-token=$DIGITAL_OCEAN_API_KEY

