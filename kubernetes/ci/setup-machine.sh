##############
# IMPORTANT:
# This script sets the CI/CD machine up to run a build job. It's usually the first script that runs
##############

# Cleanup
echo "RUNNING COMMAND:  chmod +x ./ci/cleanup.sh"
chmod +x ./kubernetes/ci/cleanup.sh
echo "RUNNING COMMAND:  ./ci/cleanup.sh"
./kubernetes/ci/cleanup.sh
# Flush all repos
echo "RUNNING COMMAND:  sudo rm /etc/apt/sources.list  || echo 'File not found'"
sudo rm /etc/apt/sources.list  || echo 'File not found'
echo "RUNNING COMMAND:  sudo rm -rf /etc/apt/sources.list.d  || echo 'File not found'"
sudo rm -rf /etc/apt/sources.list.d  || echo 'File not found'
echo "RUNNING COMMAND:  sudo touch /etc/apt/sources.list || echo 'File already exists'"
sudo touch /etc/apt/sources.list || echo 'File already exists'
echo "RUNNING COMMAND:  sudo mkdir /etc/apt/sources.list.d || echo 'Dir already exists'"
sudo mkdir /etc/apt/sources.list.d || echo 'Dir already exists'
# Install Basic Repos
echo "RUNNING COMMAND:  sudo apt-add-repository main"
sudo apt-add-repository main
echo "RUNNING COMMAND:  sudo apt-add-repository universe"
sudo apt-add-repository universe
echo "RUNNING COMMAND:  sudo apt-add-repository multiverse"
sudo apt-add-repository multiverse
echo "RUNNING COMMAND:  sudo apt-add-repository restricted"
sudo apt-add-repository restricted
# Iptables 
echo "RUNNING COMMAND:  sudo iptables -P FORWARD ACCEPT"
sudo iptables -P FORWARD ACCEPT
# Install Basic packages
echo "RUNNING COMMAND:  sudo apt-get update -y && sudo apt-get install -y curl bash git python openssl sudo apt-transport-https ca-certificates gnupg-agent software-properties-common systemd wget"
sudo apt-get update -y && sudo apt-get install -y curl bash git python openssl sudo apt-transport-https ca-certificates gnupg-agent software-properties-common systemd wget
#Install Docker and setup registry and insecure access to it.
echo "RUNNING COMMAND: curl -sSL https://get.docker.com/ | sh"
curl -sSL https://get.docker.com/ | sh
echo "RUNNING COMMAND: touch /etc/docker/daemon.json"
touch /etc/docker/daemon.json
echo "RUNNING COMMAND:  echo -e  "{\n   "insecure-registries": ["localhost:32000"]\n}" >> /etc/docker/daemon.json"
echo -e  "{\n   "insecure-registries": ["localhost:32000"]\n}" >> /etc/docker/daemon.json
echo "RUNNING COMMAND: sudo systemctl restart docker"
sudo systemctl restart docker
#Install Kubectl
echo "RUNNING COMMAND: curl -LO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl"
curl -LO https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl
echo "RUNNING COMMAND: chmod +x ./kubectl"
chmod +x ./kubectl
echo "RUNNING COMMAND: sudo mv ./kubectl /usr/local/bin/kubectl"
sudo mv ./kubectl /usr/local/bin/kubectl
#Install microK8s
echo "RUNNING COMMAND: sudo snap set system refresh.retain=2"
sudo snap set system refresh.retain=2
echo "RUNNING COMMAND: sudo snap install microk8s --classic"
sudo snap install microk8s --classic
echo "RUNNING COMMAND:  sudo usermod -a -G microk8s $USER"
sudo usermod -a -G microk8s $USER || echo "microk8s group not found"
echo "RUNNING COMMAND: microk8s.start"
microk8s.start
echo "RUNNING COMMAND: microk8s.status --wait-ready"
microk8s.status --wait-ready
echo "RUNNING COMMAND: microk8s.enable registry"
microk8s.enable registry
echo "RUNNING COMMAND: microk8s.enable dns"
microk8s.enable dns
echo "RUNNING COMMAND: iptables -P FORWARD ACCEPT"
sudo iptables -P FORWARD ACCEPT
echo "RUNNING COMMAND: microk8s.enable ingress"
microk8s.enable ingress
echo "RUNNING COMMAND: sudo microk8s.inspect"
sudo microk8s.inspect
echo "RUNNING COMMAND: sudo snap alias microk8s.kubectl kubectl"
sudo snap alias microk8s.kubectl kubectl
echo "RUNNING COMMAND: microk8s.kubectl config view --raw > $HOME/.kube/config"
microk8s.kubectl config view --raw > $HOME/.kube/config
#Kubectl version.
echo "RUNNING COMMAND: sudo kubectl version"
sudo kubectl version
# Install Mongo Shell
echo "RUNNING COMMAND: sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 9DA31620334BD75D9DCB49F368818C72E52529D4"
sudo apt-key adv --keyserver hkp://keyserver.ubuntu.com:80 --recv 9DA31620334BD75D9DCB49F368818C72E52529D4
echo "RUNNING COMMAND: echo 'deb [ arch=amd64 ] https://repo.mongodb.org/apt/ubuntu bionic/mongodb-org/4.0 multiverse' | sudo tee /etc/apt/sources.list.d/mongodb-org-4.0.list"
echo 'deb [ arch=amd64 ] https://repo.mongodb.org/apt/ubuntu bionic/mongodb-org/4.0 multiverse' | sudo tee /etc/apt/sources.list.d/mongodb-org-4.0.list
echo "RUNNING COMMAND: sudo apt-get update"
sudo apt-get update
echo "RUNNING COMMAND: sudo apt-get install -y mongodb-org"
sudo apt-get install -y mongodb-org
# Install JQ, a way for bash to interact with JSON
echo "RUNNING COMMAND: sudo apt-get install -y jq"
sudo apt-get install -y jq
# Install nodeJS
echo "RUNNING COMMAND: curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -"
curl -sL https://deb.nodesource.com/setup_10.x | sudo -E bash -
echo "RUNNING COMMAND: sudo apt install nodejs"
sudo apt install nodejs
# npm and node version check
echo "RUNNING COMMAND: node -v"
node -v
echo "RUNNING COMMAND: npm -v"
npm -v
# Install additional dependencies for puppeteer
echo "RUNNING COMMAND: sudo apt-get install -yq gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 \
libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils
"
sudo apt-get install -yq gconf-service libasound2 libatk1.0-0 libc6 libcairo2 libcups2 libdbus-1-3 \
libexpat1 libfontconfig1 libgcc1 libgconf-2-4 libgdk-pixbuf2.0-0 libglib2.0-0 libgtk-3-0 libnspr4 \
libpango-1.0-0 libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 libxcomposite1 \
libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 libxrandr2 libxrender1 libxss1 libxtst6 \
ca-certificates fonts-liberation libappindicator1 libnss3 lsb-release xdg-utils
