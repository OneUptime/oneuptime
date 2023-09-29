# Introduction


### Installation

Install Microk8s: Read the [installation guide](https://microk8s.io/docs) for more details.
Install Helm

Run 

```
sudo microk8s kubectl config view --raw > ~/.kube/config
```


### Unistallation

```bash
microk8s uninstall
```

### Addons

- Hostpath Storage if you're using one node. 

```
microk8s enable hostpath-storage

# then you should see storage class name 
kubectl get storageclass

# You can then use this storage class to run this chart
```

By default, the hostpath provisioner will store all volume data under /var/snap/microk8s/common/default-storage

To customize the default directory, please read the docs here: https://microk8s.io/docs/addon-hostpath-storage

```

# Enable Metal LB
microk8s enable metallb:192.168.0.105-192.168.0.111
```


### Common Issues

- launch failed: instance "microk8s-vm" already exists (on MacOS)

```bash
multipass delete microk8s-vm
multipass purge

# reinstall
microk8s install
microk8s status --wait-ready
```


