# Frequently used K8s commands.

# Cluster Config

```
sudo kubectl config get-contexts
sudo kubectl config use-context do-nyc1-fyipe-staging
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

This usually happens when one of the nodes is out ot memory or disk.

Run this to delete evicted pods:

```
kubectl -n default delete pods --field-selector=status.phase=Failed
```
