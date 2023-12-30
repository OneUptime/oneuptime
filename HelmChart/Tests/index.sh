# Install MicroK8s
snap install microk8s --classic
microk8s status --wait-ready


# Add current user to microk8s group
microk8s kubectl config view --raw > ~/.kube/config

# Add kubectl and helm aliases
echo "alias kubectl='microk8s kubectl'" >> ~/.bash_aliases
echo "alias helm='microk8s helm3'" >> ~/.bash_aliases

# Enable MicroK8s addons
microk8s enable dashboard
microk8s enable dns
microk8s enable hostpath-storage


# Install OneUptime 
helm install oneuptime ../../HelmChart/Public/oneuptime -f ../../HelmChart/Public/oneuptime/values.yaml -f ./ci-values.yaml

# Wait for OneUptime to be ready
kubectl wait --for=condition=ready pod -l --timeout=300s

# Once it's ready. Run helm test. 
helm test oneuptime
