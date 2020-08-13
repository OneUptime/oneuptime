echo "Get KubeCluster Config"
sudo doctl kubernetes cluster kubeconfig save fyipe-production
sudo kubectl config --kubeconfig=/root/.kube/config get-contexts
sudo kubectl config --kubeconfig=/root/.kube/config use-context do-nyc3-fyipe-production