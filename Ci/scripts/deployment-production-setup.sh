#!/usr/bin/env bash

echo "Connect machine with to communicate with aws cluster"
# This command will automatically switch to the oneuptime-production cluster

# AWS command. 
#sudo aws eks update-kubeconfig --region $AWS_DEFAULT_REGION --name fyipe-production


doctl kubernetes cluster kubeconfig save 5c53f2a7-e462-48ab-9c02-3fbe281b2568