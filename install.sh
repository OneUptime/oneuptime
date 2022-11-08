#!/usr/bin/env bash

set -e

bash preinstall.sh




if [[ ! $(which docker) && ! $(docker --version) ]]; then
  echo "Setting up Docker"
  sudo curl -sSL https://get.docker.com/ | sh  
fi


# If docker still fails to install, then quit. 
if [[ ! $(which docker) && ! $(docker --version) ]]; then
  echo -e "Failed to install docker. Please install Docker manually here: https://docs.docker.com/install."
  echo -e "Exiting the OneUptime installer."
  exit
fi


# enable docker without sudo
sudo usermod -aG docker "${USER}" || true

if [[ ! $(which docker-compose) && ! $(docker-compose --version) ]]; then
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/download/v2.12.2/docker-compose-$(uname -s)-$(uname -m) -o /usr/local/lib/docker/cli-plugins
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
docker compose version
fi

# If docker still fails to install, then quit. 
if [[ ! $(which docker-compose) && ! $(docker-compose --version) ]]; then
  echo -e "Failed to install docker-domcpose. Please install Docker Compose manually here: https://docs.docker.com/compose/install/linux/#install-the-plugin-manually."
  echo -e "Exiting the OneUptime installer."
  exit
fi






echo "We will need to wait ~5-10 minutes for things to settle down, migrations to finish, and TLS certs to be issued"
echo ""
echo "⏳ Waiting for OneUptime to boot (this will take a few minutes)"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/api/status)" != "200" ]]; do sleep 5; done'
echo "Progress 1/5"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/dashboard/status)" != "200" ]]; do sleep 5; done'
echo "Progress 2/5"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/status)" != "200" ]]; do sleep 5; done'
echo "Progress 3/5"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/staus-page/status)" != "200" ]]; do sleep 5; done'
echo "Progress 4/5"
echo "⌛️ OneUptime is up!"
echo ""
echo "🎉🎉🎉  Done! 🎉🎉🎉"

echo "We would like to hear your feedback to make this product better for you and for other users, please email us at hello@oneuptime.com."
echo " - If you notice a bug, we will fix it for you."
echo " - If you need a feature, we will add that to the roadmap and let you know the estimated time to ship."
echo "We would love to hear your feedback. Email: hello@oneuptime.com"