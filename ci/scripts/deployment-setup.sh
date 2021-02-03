# Install Kubectl
curl -LO "https://storage.googleapis.com/kubernetes-release/release/$(curl -s https://storage.googleapis.com/kubernetes-release/release/stable.txt)/bin/linux/amd64/kubectl"
sudo chmod +x ./kubectl
sudo mv ./kubectl /usr/local/bin/kubectl
sudo kubectl version --client
# Auth with DigitalOcean Client
echo "Install doctl"
sudo snap install doctl
sudo snap connect doctl:kube-config
sudo snap connect doctl:ssh-keys :ssh-keys
sudo snap connect doctl:dot-docker
# Make .config folder
sudo mkdir /root/.config || echo "Directory already created."
sudo mkdir /root/.kube || echo "Directory already created."
#Init auth
echo "Auth doctl"
sudo doctl auth init -t $DIGITALOCEAN_TOKEN

# create private key and public key
echo "Setup private and public key"
openssl genrsa -out private 2048
chmod 0400 private
openssl rsa -in private -out public -pubout
# value of DKIM dns record
echo "DKIM DNS TXT Record"
echo "DNS Selector: fyipe._domainkey"
echo "DNS Value: v=DKIM1;p=$(grep -v '^-' public | tr -d '\n')"
export PRIVATE_KEY=$(cat private | base64)
# generate tls_cert.pem and tls_key.pem files with there keys
echo "Setup tls_cert and tls_key"
openssl req -x509 -nodes -days 2190 -newkey rsa:2048 -keyout tls_key.pem -out tls_cert.pem -subj "/C=US/ST=Massachusetts/L=Boston/O=Hackerbay/CN=globalminimalism.com"
# Encode your tls to base64 and export it
export TLS_KEY=$(cat tls_key.pem | base64)
export TLS_CERT=$(cat tls_cert.pem | base64)
