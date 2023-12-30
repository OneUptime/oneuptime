
# Ceph Rook

## Install

Install Rook Ceph Operator. This documentation taken from: https://rook.io/docs/rook/latest-release/Helm-Charts/helm-charts/

```bash
helm repo add rook-release https://charts.rook.io/release
helm install --create-namespace --namespace rook-ceph rook-ceph rook-release/rook-ceph -f ceph-operator.yaml

# wait for the pods to be ready
kubectl get pods -n rook-ceph
```

Now install the Ceph Cluster. 

```bash
helm install --create-namespace --namespace rook-ceph rook-ceph-cluster \
   --set operatorNamespace=rook-ceph rook-release/rook-ceph-cluster -f ceph-cluster.yaml
```
