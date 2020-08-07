echo "Remove Google Cloud SDK"
sudo rm -rf /home/gitlab-runner/google-cloud-sdk
echo "Remove Google Cloud Logs"
sudo rm -rf /home/gitlab-runner/.config/gcloud
curl -sSL https://sdk.cloud.google.com | bash > /dev/null;
source $HOME/google-cloud-sdk/path.bash.inc
$HOME/google-cloud-sdk/bin/gcloud components update kubectl
# Auth with DigitalOcean Client
echo "Install doctl"
sudo snap install doctl
sudo snap connect doctl:kube-config
sudo snap connect doctl:ssh-keys :ssh-keys
sudo snap connect doctl:dot-docker
#Init auth
echo "Auth doctl"
sudo doctl auth init -t $DIGITALOCEAN_TOKEN