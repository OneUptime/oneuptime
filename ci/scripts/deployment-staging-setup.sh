#!/usr/bin/env bash

# echo "Get KubeCluster Config"
# sudo doctl kubernetes cluster kubeconfig save staging
# sudo kubectl config --kubeconfig=/root/.kube/config get-contexts
# sudo kubectl config --kubeconfig=/root/.kube/config use-context do-lon1-staging

echo "Connect machine with to communicate with aws cluster"
# This command will automatically switch to the cluster
aws eks update-kubeconfig --region us-east-2 --name fyipe-staging

echo "List all the k8 contexts"
sudo kubectl config get-contexts