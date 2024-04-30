# This script generates or renews certs for this server. 
export $(grep -v '^#' config.env | xargs)
npm run prerun
docker compose stop ingress
sudo snap install core
sudo snap refresh core
sudo apt-get remove certbot
sudo snap install --classic certbot
sudo ln -s /snap/bin/certbot /usr/bin/certbot
sudo certbot certonly --standalone
sudo certbot renew --dry-run
sudo cp /etc/letsencrypt/live/$HOST/fullchain.pem $(pwd)/Certs/ServerCerts/Cert.crt 
sudo cp /etc/letsencrypt/live/$HOST/privkey.pem $(pwd)/Certs/ServerCerts/Key.key
docker compose start ingress