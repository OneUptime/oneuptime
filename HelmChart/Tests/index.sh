#!/usr/bin/env bash
set -euo pipefail

# This script sets up a lightweight Kubernetes cluster (KinD) on GitHub Actions,
# installs a default storage class, deploys the OneUptime Helm chart, and waits
# for all pods to become Ready.

# Always collect diagnostics (pod descriptions and logs for all containers)
# at the end of the run, regardless of success or failure.
dump_pod_info() {
    echo "\n================= Cluster diagnostics (all namespaces) ================="
    # Pod summary across namespaces
    kubectl get pods -A -o wide || true

    # Describe and fetch logs for each pod and container (including init containers)
    # Extract "namespace name" pairs using jsonpath
    local pods_list
    pods_list=$(kubectl get pods -A -o jsonpath='{range .items[*]}{.metadata.namespace}{" "}{.metadata.name}{"\n"}{end}' 2>/dev/null || true)
    while read -r ns pod; do
        if [ -z "${ns:-}" ] || [ -z "${pod:-}" ]; then continue; fi
        echo "\n----- Describe: $ns/$pod -----"
        kubectl describe pod "$pod" -n "$ns" || true

        # Init containers
        local init_containers
        init_containers=$(kubectl get pod "$pod" -n "$ns" -o jsonpath='{.spec.initContainers[*].name}' 2>/dev/null || true)
        for c in $init_containers; do
            echo "\n>>> Logs for init container $ns/$pod/$c (current, last 200 lines)"
            kubectl logs "$pod" -n "$ns" -c "$c" --tail=200 || true
            echo ">>> Logs for init container $ns/$pod/$c (previous, last 200 lines)"
            kubectl logs "$pod" -n "$ns" -c "$c" -p --tail=200 || true
        done

        # App containers
        local app_containers
        app_containers=$(kubectl get pod "$pod" -n "$ns" -o jsonpath='{.spec.containers[*].name}' 2>/dev/null || true)
        for c in $app_containers; do
            echo "\n>>> Logs for container $ns/$pod/$c (current, last 200 lines)"
            kubectl logs "$pod" -n "$ns" -c "$c" --tail=200 || true
            echo ">>> Logs for container $ns/$pod/$c (previous, last 200 lines)"
            kubectl logs "$pod" -n "$ns" -c "$c" -p --tail=200 || true
        done
    done <<< "$pods_list"

    echo "\n=== Recent cluster events (last 200) ==="
    kubectl get events -A --sort-by=.metadata.creationTimestamp | tail -n 200 || true
    echo "=======================================================================\n"
}

# Register trap to always run diagnostics
trap 'dump_pod_info' EXIT

echo "Setting up Kubernetes (KinD) cluster for Helm chart tests..."

# Install kubectl
if ! command -v kubectl >/dev/null 2>&1; then
    echo "Installing kubectl..."
    curl -sSL -o kubectl "https://storage.googleapis.com/kubernetes-release/release/$(curl -sSL https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl"
    sudo install -m 0755 kubectl /usr/local/bin/kubectl
    rm -f kubectl
fi

# Install kind
if ! command -v kind >/dev/null 2>&1; then
    echo "Installing kind..."
    curl -sSL -o kind https://kind.sigs.k8s.io/dl/v0.23.0/kind-linux-amd64
    sudo install -m 0755 kind /usr/local/bin/kind
    rm -f kind
fi

# Install Helm
if ! command -v helm >/dev/null 2>&1; then
    echo "Installing Helm..."
    curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash
fi

# Create cluster
CLUSTER_NAME="oneuptime-ci"
if ! kind get clusters | grep -q "^${CLUSTER_NAME}$"; then
    echo "Creating KinD cluster: ${CLUSTER_NAME}"
    kind create cluster --name "${CLUSTER_NAME}" --wait 180s
fi

echo "KinD cluster is ready. Installing default StorageClass (local-path)."
# Install Rancher local-path-provisioner and set it as default SC
kubectl apply -f https://raw.githubusercontent.com/rancher/local-path-provisioner/master/deploy/local-path-storage.yaml
kubectl wait --for=condition=Available --timeout=120s -n kube-system deploy/local-path-provisioner || true
kubectl annotate storageclass local-path storageclass.kubernetes.io/is-default-class="true" --overwrite || true

echo "Cluster Nodes:"
kubectl get nodes -o wide

echo "Installing OneUptime via Helm"
kubectl get pods -A || true

# Install OneUptime. Override storageClass to local-path for KinD
helm install oneuptime ../../HelmChart/Public/oneuptime \
    -f ../../HelmChart/Public/oneuptime/values.yaml \
    -f ./ci-values.yaml 


# Wait for all pods in the default namespace to be ready (max attempts)
echo "Waiting for all pods to be ready..."
attempt=1
max_attempts=50
sleep_seconds=30
while [ $attempt -le $max_attempts ]; do
    # Get pod list; treat kubectl errors/refusals as not-ready and retry
    if ! pods_output=$(kubectl get pods --no-headers 2>/dev/null); then
        echo "Attempt $attempt/$max_attempts: kubectl not ready yet (connection error)."
        echo "Waiting for $sleep_seconds seconds before rechecking..."
        sleep "$sleep_seconds"
        attempt=$((attempt + 1))
        continue
    fi

    # If there are no pods yet, keep waiting
    if [ -z "$pods_output" ]; then
        echo "Attempt $attempt/$max_attempts: No pods found yet."
        echo "Waiting for $sleep_seconds seconds before rechecking..."
        sleep "$sleep_seconds"
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
        kubectl get pods -o wide || true
        break
    fi

    echo "Attempt $attempt/$max_attempts: Not all pods are ready yet."
    echo "Current pod status:"
    kubectl get pods -o wide || true
    echo "Waiting for $sleep_seconds seconds before rechecking..."
    sleep "$sleep_seconds"
    attempt=$((attempt + 1))
done

if [ $attempt -gt $max_attempts ]; then
    echo "Pods are not ready after $max_attempts attempts."
    echo "Current pod status:"
    kubectl get pods -o wide || true

    echo "\nCluster events (last 200):"
    kubectl get events --sort-by=.metadata.creationTimestamp | tail -n 200 || true

    # Recompute not-ready pods for diagnostics
    pods_snapshot=$(kubectl get pods --no-headers 2>/dev/null || true)
    if [ -n "$pods_snapshot" ]; then
        not_ready_snapshot=$(echo "$pods_snapshot" | awk '{
            name=$1; ready=$2; status=$3;
            if (status=="Completed" || status=="Succeeded") {next}
            split(ready, arr, "/");
            if (status=="Running" && arr[1]==arr[2]) {next}
            print name;
        }')
        for pod in $not_ready_snapshot; do
            echo "\nDescribing pod: $pod"
            kubectl describe pod "$pod" || true
            echo "Logs (last 200 lines) for pod: $pod"
            kubectl logs "$pod" --all-containers=true --tail=200 || true
        done
    fi
    exit 1
fi
