#!/usr/bin/env bash

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
max_attempts=50
while [ $attempt -le $max_attempts ]; do
    # Get pod list; treat kubectl errors/refusals as not-ready and retry
    if ! pods_output=$(sudo microk8s kubectl get pods --no-headers 2>/dev/null); then
        echo "Attempt $attempt/$max_attempts: kubectl not ready yet (connection error)."
        echo "Waiting for 5 seconds before rechecking..."
        sleep 5
        attempt=$((attempt + 1))
        continue
    fi

    # If there are no pods yet, keep waiting
    if [ -z "$pods_output" ]; then
        echo "Attempt $attempt/$max_attempts: No pods found yet."
        echo "Waiting for 5 seconds before rechecking..."
        sleep 5
        attempt=$((attempt + 1))
        continue
    fi

    # Determine pods that are not yet ready:
    # Ready when:
    #  - STATUS is Completed/Succeeded (job pods), OR
    #  - STATUS is Running AND READY is x/y with x==y
    not_ready_pods=$(echo "$pods_output" | awk '{
        name=$1; ready=$2; status=$3;
        if (status=="Completed" || status=="Succeeded") {next}
        split(ready, arr, "/");
        if (status=="Running" && arr[1]==arr[2]) {next}
        print name;
    }')

    if [ -z "$not_ready_pods" ]; then
        echo "All pods are ready."
        sudo microk8s kubectl get pods -o wide || true
        break
    fi

    echo "Attempt $attempt/$max_attempts: Not all pods are ready yet."
    echo "Current pod status:"
    sudo microk8s kubectl get pods -o wide || true
    echo "Waiting for 5 seconds before rechecking..."
    sleep 5
    attempt=$((attempt + 1))
done

if [ $attempt -gt $max_attempts ]; then
    echo "Pods are not ready after $max_attempts attempts."
    echo "Current pod status:"
    sudo microk8s kubectl get pods -o wide || true

    # Recompute not-ready pods for diagnostics
    pods_snapshot=$(sudo microk8s kubectl get pods --no-headers 2>/dev/null || true)
    if [ -n "$pods_snapshot" ]; then
        not_ready_snapshot=$(echo "$pods_snapshot" | awk '{
            name=$1; ready=$2; status=$3;
            if (status=="Completed" || status=="Succeeded") {next}
            split(ready, arr, "/");
            if (status=="Running" && arr[1]==arr[2]) {next}
            print name;
        }')
        for pod in $not_ready_snapshot; do
            echo "Describing pod: $pod"
            sudo microk8s kubectl describe pod "$pod" || true
            echo "Logs (last 200 lines) for pod: $pod"
            sudo microk8s kubectl logs "$pod" --all-containers=true --tail=200 || true
        done
    fi
    exit 1
fi
