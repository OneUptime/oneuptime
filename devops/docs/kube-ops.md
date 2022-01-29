# Frequently used K8s commands.

# Cluster Config

```
sudo kubectl config get-contexts
sudo kubectl config use-context arn:aws:eks:us-east-2:972164494713:cluster/oneuptime-staging
```

# Pods

```
sudo kubectl get pods
```

# Persistent Volumes

```
sudo kubectl get pv
```

# Pods are evicted

You might have to scale the cluster and add more nodes to it.

This usually happens when one of the nodes is out ot memory or disk. Ideally kill the cluster and create a new cluster.

Run this to delete evicted pods:

```
kubectl -n default delete pods --field-selector=status.phase=Failed
```
