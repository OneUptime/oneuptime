# Haraka Docker Container for Fyipe

This is a simple SMTP server which is used to send bulk emails. This can be used to send email alerts to subscribers and team.

## Important

-   This will not work on your local machine because email sending is blocked by ISP. You need to run these on the server and test.
-   Once the docker container is running, please check the logs for the generated DKIM

## Run a Fyipe Haraka Docker Container

Before you run the haraka smtp docker container, you need to create private and tls keys

### Setup Private Key

```
# Unix machine


# create a file private and store private key inside it

openssl genrsa -out private 2048

# Encode it to base64 and export it

export PRIVATE_KEY=$(cat private | base64)

```

### Setup tls Keys

```
# Unix machine


# generate tls_cert.pem and tls_key.pem files with there keys
# only run this step if you don't have tls_key.pem and tls_cert.pem keys, if you do move to the next stage
# this command will open a prompt for you to fill in your details

openssl req -x509 -nodes -days 2190 -newkey rsa:2048 -keyout tls_key.pem -out tls_cert.pem

# Encode your tls to base64 and export it

export TLS_KEY=$(cat tls_key.pem | base64)
export TLS_CERT=$(cat tls_cert.pem | base64)

```

### Setup DKIM on DNS TXT Record

```
# Unix machine

# private should point to the private key generated previously

chmod 0400 private
openssl rsa -in private -out public -pubout

# value of DKIM dns record

echo "v=DKIM1;p=$(grep -v '^-' public | tr -d '\n')"

```

> When setting up the DKIM dns txt record, the selector should be `fyipe._domainkey` then the value should be the output of the echo command

## Build Docker Container

```
docker build --build-arg PORT="2525" . -t haraka:latest
```

### Run Haraka SMTP Server

```
docker run -p 2525:2525 -e SMTP_USER="user@hackerbay.io" -e SMTP_PASSWORD="hackerbay" -e DOMAIN="globalminimalism.com" -e PRIVATE_KEY=$PRIVATE_KEY -e TLS_CERT=$TLS_CERT -e TLS_KEY=$TLS_KEY  haraka:latest
```

## Test

```
# Install swaks on Linux machine

sudo apt-get update
sudo apt-get install swaks -y

# MacOS

brew install swaks

# Test

swaks --to jude@hackerbay.io --from support@globalminimalism.com --server localhost \
  --port 2525 --auth-user user@hackerbay.io --auth-password hackerbay

```

Check the logs for running container and see if you get a mail in your inbox.
