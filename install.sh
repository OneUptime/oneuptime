#!/bin/bash

# This script runs the local development server in Docker.
if [[ ! $(which docker) && ! $(docker --version) ]]; then
  echo -e "\033[91mPlease install Docker. https://docs.docker.com/install"
  exit
fi

# create private key and public key
openssl genrsa -out private 2048
chmod 0400 private
openssl rsa -in private -out public -pubout

# value of DKIM dns record
echo "DKIM DNS TXT Record"
echo "DNS Selector: fyipe._domainkey"
echo "DNS Value: v=DKIM1;p=$(grep -v '^-' public | tr -d '\n')"
export PRIVATE_KEY=$(cat private | base64)

# generate tls_cert.pem and tls_key.pem files with there keys
openssl req -x509 -nodes -days 2190 -newkey rsa:2048 -keyout tls_key.pem -out tls_cert.pem -subj "/C=US/ST=Massachusetts/L=Boston/O=Hackerbay/CN=globalminimalism.com"

# Encode your tls to base64 and export it
export TLS_KEY=$(cat tls_key.pem | base64)
export TLS_CERT=$(cat tls_cert.pem | base64)

sudo chmod +x ./uninstall.sh
sudo ./uninstall.sh

# Sleep
sleep 5s

#Docker compose up as a daemon.
sudo -E docker-compose up -d --build
