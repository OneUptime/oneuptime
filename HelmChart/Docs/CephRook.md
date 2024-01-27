
# Ceph Rook

## Install

Install Rook Ceph Operator. This documentation taken from: https://rook.io/docs/rook/latest-release/Helm-Charts/helm-charts/

```bash
helm repo add rook-release https://charts.rook.io/release
# Install with default values.yaml
helm install --create-namespace --namespace rook-ceph rook-ceph rook-release/rook-ceph 

# wait for the pods to be ready
kubectl get pods -n rook-ceph
```

Now install the Ceph Cluster. 

```bash
# Install with default values.yaml
helm install --create-namespace --namespace rook-ceph rook-ceph-cluster \
   --set operatorNamespace=rook-ceph rook-release/rook-ceph-cluster

# Check install progression by using this command. 
kubectl --namespace rook-ceph get cephcluster


# Check the pods 
kubectl get pods -n rook-ceph
```

Once you install the cluster, you can check the status of the cluster by running this command: 

```bash
kubectl -n rook-ceph exec -it rook-ceph-tools -- ceph status
```

See all the storage classes by running this command: 

```bash
kubectl get storageclass
```

You should see ceph created storage classes. 


## Ceph Dashboard

You can access the dashboard by running this command: 

Get the login credentials

```bash
kubectl -n rook-ceph get secret rook-ceph-dashboard-password -o jsonpath="{['data']['password']}" | base64 --decode && echo
```

Then run this command to port forward the dashboard.

```bash
kubectl -n rook-ceph port-forward svc/rook-ceph-mgr-dashboard 8443:8443 --address 0.0.0.0
```

Then you can access the dashboard by going to: https://<IP_ADDRESS_OF_SERVER>:8443


Username is `admin` and password is the one you got from the previous command.