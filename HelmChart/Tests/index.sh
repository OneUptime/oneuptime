# Install MicroK8s
sudo snap install microk8s --classic
sudo microk8s status --wait-ready

# Add kubectl and helm aliases
sudo echo "alias kubectl='microk8s kubectl'" >> ~/.bash_aliases
sudo echo "alias helm='microk8s helm3'" >> ~/.bash_aliases

source ~/.bash_aliases

# Enable MicroK8s addons
sudo microk8s enable dashboard
sudo microk8s enable dns
sudo microk8s enable hostpath-storage

echo "MicroK8s is ready. Installing OneUptime"
# Get pods 
sudo microk8s kubectl get pods

# Install OneUptime 
sudo microk8s helm install oneuptime ../../HelmChart/Public/oneuptime -f ../../HelmChart/Public/oneuptime/values.yaml -f ./ci-values.yaml


echo "OneUptime is installed. Waiting for it to be ready. Checking status in 20 mins once things settle down..."
sleep 20m

# Wait for OneUptime to be ready
timeout 30m bash -c '
    endtime=$((SECONDS+600))
    while [ $SECONDS -lt $endtime ]; do
        if sudo microk8s kubectl wait pod --all --for=condition=Ready --namespace=default --timeout=5m; then
            echo "All pods are ready"
            exit 0
        fi
        echo "Some pods are not ready yet. Getting status of all the pods: "
        sudo microk8s kubectl get pods --all-namespaces
        sleep 1m
    done
    echo "Timeout reached. Some pods failed to start"
    exit 1
'

# Once it's ready. Run helm test. 
# sudo microk8s helm test oneuptime
