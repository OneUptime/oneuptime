#!/usr/bin/env bash

echo "Connect machine with to communicate with aws cluster"
# This command will automatically switch to the fyipe-production cluster
aws eks update-kubeconfig --region ${{ secrets.AWS_DEFAULT_REGION }} --name fyipe-production
