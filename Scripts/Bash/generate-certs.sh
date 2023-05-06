#!/usr/bin/env bash

set -e

CERT=./Certs/ServerCerts/Cert.crt
if test -f "$CERT"; then
    echo "SSL Certificate exists. Skipping generating a new one."
else
    echo "SSL Certificate not found. Generating a new certificate."
    openssl req -new -x509 -nodes -subj "/C=GB/ST=London/L=London/O=Global Security/OU=IT Department/CN=example.com" -out ./Certs/ServerCerts/Cert.crt -keyout ./Certs/ServerCerts/Key.key -days 99999
fi