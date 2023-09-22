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

### Common Issues

- launch failed: instance "microk8s-vm" already exists (on MacOS)

```bash
multipass delete microk8s-vm
multipass purge

# reinstall
microk8s install
microk8s status --wait-ready
```


