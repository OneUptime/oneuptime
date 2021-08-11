#!/bin/bash

echo "Get KubeCluster Config"
sudo doctl kubernetes cluster kubeconfig save staging
sudo kubectl config --kubeconfig=/root/.kube/config get-contexts
sudo kubectl config --kubeconfig=/root/.kube/config use-context do-lon1-staging