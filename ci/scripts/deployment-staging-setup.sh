#!/usr/bin/env bash

echo "Connect machine with to communicate with aws cluster"
# This command will automatically switch to the oneuptime-staging cluster
sudo aws eks update-kubeconfig --region $AWS_DEFAULT_REGION --name oneuptime-staging
