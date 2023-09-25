# Helm Chart for OneUptime

## Introduction

This chart bootstraps a [OneUptime](https://oneuptime.com) deployment on a [Kubernetes](http://kubernetes.io) cluster using the [Helm](https://helm.sh) package manager.

## Adding Dependencies 

- Add dependencies in Chart.yaml and run helm dependency update.

## Addons for MicroK8s

- Hostpath Storage if you're using one node. 

```
microk8s enable hostpath-storage

# then you should see storage class name 
kubectl get storageclass

# You can then use this storage class to run this chart
```

By default, the hostpath provisioner will store all volume data under /var/snap/microk8s/common/default-storage

To customize the default directory, please read the docs here: https://microk8s.io/docs/addon-hostpath-storage