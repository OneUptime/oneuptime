# Install MicroK8s
sudo snap install microk8s --classic
sudo microk8s status --wait-ready

# Add kubectl and helm aliases
sudo echo "alias kubectl='microk8s kubectl'" >> ~/.bash_aliases
sudo echo "alias helm='microk8s helm3'" >> ~/.bash_aliases

source ~/.bash_aliases

# Enable MicroK8s addons
sudo microk8s enable dashboard
sudo microk8s enable dns
sudo microk8s enable hostpath-storage


# Install OneUptime 
sudo microk8s helm install oneuptime ../../HelmChart/Public/oneuptime -f ../../HelmChart/Public/oneuptime/values.yaml -f ./ci-values.yaml

# Wait for OneUptime to be ready
sudo microk8s kubectl wait --for=condition=ready pod -l --timeout=300s

# Once it's ready. Run helm test. 
sudo microk8s helm test oneuptime
