# SMTP Server Container for Fyipe

This is a simple SMTP server which is used to send bulk emails. This can be used to send email alerts to subscribers and team.

> This will not work on your local machine because email sending is blocked by ISP. You need to run these on the server and test.

## Run a Fyipe Haraka Docker Container

### Setup Private Key (Optional)

```
# Unix machine


# generate private key

openssl genrsa -out private 2048

# Encode it to base64 and export it

export DKIM_PRIVATE_KEY=$(cat private | base64)

```

> If you already have a private key, you can point the export command to it, and export as base64 encoded

### Setup DKIM on DNS TXT Record (Optional)

```
# Unix machine

# private should point to the private key generated previously

chmod 0400 private
openssl rsa -in private -out public -pubout

# value of DKIM dns record

echo "v=DKIM1;p=$(grep -v '^-' public | tr -d '\n')"

```

> When setting up the DKIM dns txt record (recommended), the selector should be `fyipe._domainkey` then the value should be the output of the echo command

### Setup DMARC and SPF DNS TXT Record (Optional)

To setup dmarc for the smtp server, you need to create a new dns record with the following values

| Type | Name    | Content                                                                                  |
| ---- | ------- | ---------------------------------------------------------------------------------------- |
| TXT  | \_dmarc | v=DMARC1; p=reject; adkim=s; aspf=r; rua=mailto:youremail; ruf=mailto:youremail; pct=100 |

> For SPF dns record, you need to setup with appropriate values, if the ip of the smtp mail server is static, you can add that to the spf ip list

### Setup tls Keys (Optional)

```
# Unix machine


# generate tls_cert.pem and tls_key.pem files with there keys
# this command will open a prompt for you to fill in your details

openssl req -x509 -nodes -days 2190 -newkey rsa:2048 -keyout tls_key.pem -out tls_cert.pem

# Encode your tls to base64 and export it

export TLS_KEY=$(cat tls_key.pem | base64)
export TLS_CERT=$(cat tls_cert.pem | base64)

```

> If you already have tls_key and tls_cert for your domain, you can point the export command to the tls files to generate base64 encoded value

## Build Docker Container

```
docker build --build-arg PORT="2525" . -t haraka:latest
```

### Run Haraka SMTP Server

```
docker run -p 2525:2525 -e SMTP_USER="user@fyipe.com" -e SMTP_PASSWORD="fyipe" -e DOMAIN="fyipe.com" -e DKIM_PRIVATE_KEY=$DKIM_PRIVATE_KEY -e TLS_CERT=$TLS_CERT -e TLS_KEY=$TLS_KEY  haraka:latest
```

> The following envs are optional `DKIM_PRIVATE_KEY`, `TLS_CERT`, `TLS_KEY` and `DOMAIN`

## Test

```
# Install swaks on Linux machine

sudo apt-get update
sudo apt-get install swaks -y

# MacOS

brew install swaks

# Test

swaks --to jude@hackerbay.io --from support@fyipe.com --server localhost \
  --port 2525 --auth-user user@fyipe.com --auth-password fyipe

```

Check the logs for running container and see if you get a mail in your inbox.
