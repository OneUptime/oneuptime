echo "Get KubeCluster Config"
sudo doctl kubernetes cluster kubeconfig save fyipe-staging
sudo mv /root/.kube/config /gitlab-runner/.kube/config 
sudo kubectl config get-contexts
sudo kubectl config use-context do-nyc3-fyipe-staging