echo "Get KubeCluster Config"
sudo doctl kubernetes cluster kubeconfig save fyipe-production
sudo kubectl config use-context do-nyc3-fyipe-production