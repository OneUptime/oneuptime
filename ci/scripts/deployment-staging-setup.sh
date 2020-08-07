echo "Get KubeCluster Config"
sudo doctl kubernetes cluster kubeconfig save fyipe-staging
sudo kubectl config use-context do-nyc3-fyipe-staging