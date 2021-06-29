
chmod +x env-setup.sh

bash ./env-setup.sh
#Docker compose up as a daemon.
sudo -E docker-compose up -d --build
