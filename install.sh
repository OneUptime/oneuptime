# This script runs the local development server in Docker.
if [[ ! $(which docker) && ! $(docker  --version) ]]
then
  echo -e "\033[91mPlease install Docker. https://docs.docker.com/install"
  exit
fi

sudo chmod +x ./uninstall.sh
sudo ./uninstall.sh

# Sleep 
sleep 5s

#Docker compose up as a daemon.
sudo docker-compose up -d --build