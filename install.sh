#!/bin/bash

# This script runs the local development server in Docker.
if [[ ! $(which docker) && ! $(docker --version) ]]; then
  echo -e "\033[91mPlease install Docker. https://docs.docker.com/install"
  exit
fi

if [[ ! -n $DOMAIN ]]; then
    export DOMAIN=fyipe.com
fi

if [[ ! -n $DKIM_PRIVATE_KEY ]]; then
    # create private key and public key
    echo "Setup private and public key"
    openssl genrsa -out private 2048
    chmod 0400 private
    openssl rsa -in private -out public -pubout
    # value of DKIM dns record
    echo "DKIM DNS TXT Record"
    echo "DNS Selector: fyipe._domainkey"
    echo "DNS Value: v=DKIM1;p=$(grep -v '^-' public | tr -d '\n')"
    export DKIM_PRIVATE_KEY=$(cat private | base64)
fi

if [[ ! -n $TLS_KEY ]] && [[ ! -n $TLS_CERT ]]; then
    # generate tls_cert.pem and tls_key.pem files with there keys
    echo "Setup tls_cert and tls_key"
    openssl req -x509 -nodes -days 2190 -newkey rsa:2048 -keyout tls_key.pem -out tls_cert.pem -subj "/C=US/ST=Massachusetts/L=Boston/O=Hackerbay/CN=$DOMAIN"
    # Encode your tls to base64 and export it
    export TLS_KEY=$(cat tls_key.pem | base64)
    export TLS_CERT=$(cat tls_cert.pem | base64)
fi

sudo chmod +x ./uninstall.sh
sudo ./uninstall.sh

# Sleep
sleep 5s

#Docker compose up as a daemon.
sudo -E docker-compose up -d --build
