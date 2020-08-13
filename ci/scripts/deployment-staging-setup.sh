echo "Get KubeCluster Config"
sudo doctl kubernetes cluster kubeconfig save fyipe-staging
sudo cp /root/.kube/config /gitlab-runner/.kube/config || echo "Unable to copy"
sudo kubectl config --kubeconfig=/root/.kube/config get-contexts
sudo kubectl config --kubeconfig=/root/.kube/config use-context do-nyc3-fyipe-staging