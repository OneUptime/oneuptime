echo "Get KubeCluster Config"
sudo doctl kubernetes cluster kubeconfig save production
sudo kubectl config --kubeconfig=/root/.kube/config get-contexts
sudo kubectl config --kubeconfig=/root/.kube/config use-context do-nyc3-production