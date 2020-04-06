#!/bin/bash

# Construct GCP Deployer.
rm -rf ./gcp-deployer/chart
mkdir ./gcp-deployer/chart
cp -R ./helm-chart/public/fyipe ./gcp-deployer/chart
cp ./gcp-deployer/application.yaml ./gcp-deployer/chart/fyipe/templates
cp ./gcp-deployer/billing-agent.yaml ./gcp-deployer/chart/fyipe/templates
sudo cat ./gcp-deployer/values.yaml >> ./gcp-deployer/chart/fyipe/values.yaml

# Build and push docker container.
sudo docker build --tag gcr.io/fyipe-public/fyipe/deployer ./gcp-deployer
sudo docker push gcr.io/fyipe-public/fyipe/deployer/

