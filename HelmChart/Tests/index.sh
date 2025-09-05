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


# Wait for all pods in the default namespace to be ready (max 30 attempts)
echo "Waiting for all pods to be ready..."
attempt=1
max_attempts=30
while [ $attempt -le $max_attempts ]; do
    not_ready_pods=$(sudo microk8s kubectl get pods --no-headers | grep -vE 'Running|Completed|Succeeded' | awk '{print $1}')
    if [ -z "$not_ready_pods" ]; then
        echo "All pods are ready."
        break
    fi
    echo "Attempt $attempt/$max_attempts: Not all pods are ready yet."
    echo "Current pod status:"
    sudo microk8s kubectl get pods -o wide
    echo "Waiting for 5 seconds before rechecking..."
    sleep 5
    attempt=$((attempt + 1))
done

if [ $attempt -gt $max_attempts ]; then
    echo "Pods are not ready after $max_attempts attempts."
    echo "Current pod status:"
    sudo microk8s kubectl get pods -o wide
    for pod in $not_ready_pods; do
        echo "Describing pod: $pod"
        sudo microk8s kubectl describe pod "$pod"
    done
    exit 1
fi
