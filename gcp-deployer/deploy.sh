#!/bin/bash

# Construct GCP Deployer.
rm -rf ./gcp-deployer/chart
mkdir ./gcp-deployer/chart
cp -R ./helm-chart/public/fyipe ./gcp-deployer/chart
cp ./gcp-deployer/application.yaml ./gcp-deployer/chart/fyipe/templates
cp ./gcp-deployer/billing-agent.yaml ./gcp-deployer/chart/fyipe/templates

# Find and replace.
if [[ "$OSTYPE" == "darwin"* ]]; then
    # Mac OSX
    sed -i '' 's/isThirdPartyBilling: false/isThirdPartyBilling: true/g' gcp-deployer/chart/fyipe/values.yaml
    sed -i '' 's/isRunningOnGCPMarketplace: false/isRunningOnGCPMarketplace: true/g' gcp-deployer/chart/fyipe/values.yaml
else
    # Linux
    sed -i '' 's/isThirdPartyBilling: false/isThirdPartyBilling: true/g' gcp-deployer/chart/fyipe/values.yaml
    sed -i '' 's/isRunningOnGCPMarketplace: false/isRunningOnGCPMarketplace: true/g' gcp-deployer/chart/fyipe/values.yaml
fi

# Get latest Universal Billing Agent from Google Marketplace and push it to our Fyipe repo.
sudo docker pull gcr.io/cloud-marketplace-tools/metering/ubbagent
sudo docker tag gcr.io/cloud-marketplace-tools/metering/ubbagent gcr.io/fyipe-public/fyipe/ubbagent:3.0
sudo docker tag gcr.io/cloud-marketplace-tools/metering/ubbagent gcr.io/fyipe-public/fyipe/ubbagent:latest
sudo docker push gcr.io/fyipe-public/fyipe/ubbagent:3.0
sudo docker push gcr.io/fyipe-public/fyipe/ubbagent:latest

# Build and push docker container.
sudo docker build --tag gcr.io/fyipe-public/fyipe/deployer:3.0 ./gcp-deployer
sudo docker tag gcr.io/fyipe-public/fyipe/deployer:3.0 gcr.io/fyipe-public/fyipe/deployer:latest
sudo docker push gcr.io/fyipe-public/fyipe/deployer:3.0
sudo docker push gcr.io/fyipe-public/fyipe/deployer:latest

