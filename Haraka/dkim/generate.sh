#!/bin/sh


cd keys

openssl genrsa -out private 4096
chmod 0400 private
openssl rsa -in private -out public -pubout

cd ..

bash show-info.sh
