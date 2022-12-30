# Run this cron every day to see if the cert needs renewal. 
export $(grep -v '^#' config.env | xargs)
npm run prerun
docker compose nginx stop
sudo certbot renew
sudo cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $(pwd)/Certs/ServerCerts/Cert.crt 
sudo cp /etc/letsencrypt/live/$DOMAIN/privkey.pem $(pwd)/Certs/ServerCerts/Key.key
docker compose start nginx