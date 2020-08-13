echo "Get KubeCluster Config"
sudo doctl kubernetes cluster kubeconfig save fyipe-production
sudo kubectl config --kubeconfig=$KUBECONFIG get-contexts
sudo kubectl config --kubeconfig=$KUBECONFIG use-context do-nyc3-fyipe-production