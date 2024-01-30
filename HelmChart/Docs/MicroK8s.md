# Introduction


### Installation

Install Microk8s: Read the [installation guide](https://microk8s.io/docs) for more details.
Install Helm

Run 

```
sudo microk8s kubectl config view --raw > ~/.kube/config
```


### Bash Alias

Edit bashrc file and add these aliases

```bash
vi ~/.bashrc
```


Add these lines to it: 


```bash
alias kubectl='microk8s kubectl'
alias helm='microk8s helm3'
```

Save it and run `source ~/.bashrc`

### Setup Addons

- Hostpath Storage (skip if you're running on a multinode cluster)

Use MicroCeph if you have multiple nodes. **If you're using the miltinode k8s cluster, you can skip this step.**. Please read Ceph Installation guide at `HelmChart/Docs/MicroCeph.md` for more details 

```
microk8s enable hostpath-storage

# then you should see storage class name 
kubectl get storageclass

# You can then use this storage class to run this chart
```

By default, the hostpath provisioner will store all volume data under /var/snap/microk8s/common/default-storage

To customize the default directory, please read the docs here: https://microk8s.io/docs/addon-hostpath-storage


- Metal LB

```

# Enable Metal LB
microk8s enable metallb:192.168.0.105-192.168.0.111
```

- Kubernetes Dashboard

```
microk8s enable dashboard
```

and then you can run `microk8s dashboard-proxy` to access the dashboard.


- DNS

```
microk8s enable dns
```

- Rook Ceph

**Skip this step if you're NOT running on a multinode cluster**

```
microk8s enable rook-ceph
sudo microk8s connect-external-ceph
```

After running the above command, check if you see the storageclass:

```
kubectl get storageclass
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


### Unistallation

```bash
microk8s uninstall
```

### High Availability

Microk8s in a multi-node configuration is highly available. You can add and remove nodes without downtime.

#### Network High Availability

Use a Load Balancer to distribute traffic across the nodes. The Load Balancer can be a physical device or a software solution like HAProxy. The Load Balancer should be configured to forward traffic to the nodes on ports 80, 443 and have the LoadBalancer IP as the destination IP for the traffic in DNS and MetalLB. 

#### Storage High Availability

Ceph takes care of storage high availability. Please read the docs at `HelmChart/Docs/MicroCeph.md` for more details.