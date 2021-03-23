echo "Get KubeCluster Config"
sudo doctl kubernetes cluster kubeconfig save fyipe-staging
sudo kubectl config --kubeconfig=/root/.kube/config get-contexts
sudo kubectl config --kubeconfig=/root/.kube/config use-context do-nyc1-fyipe-staging