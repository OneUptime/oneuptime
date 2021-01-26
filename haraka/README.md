# Haraka Docker Container for Fyipe

This is a simple SMTP server which is used to send bulk emails. This can be used to send email alerts to subscribers and team.

## Important

-   This will not work on your local machine because email sending is blocked by ISP. You need to run these on the server and test.
-   Once the docker container is running, please check the logs for the generated DKIM

## Build Docker Container

```
docker build --build-arg PORT="2525" . -t haraka:latest
```

## Run a Fyipe Haraka Docker Container

```
docker run -p 2525:2525 -e SMTP_USER="user@hackerbay.io" -e SMTP_PASSWORD="hackerbay"  haraka:latest
```

## Test

```
# Ubuntu
sudo apt-get update
sudo apt-get install swaks -y

# MacOS
brew install swaks

# Test
swaks --to jude@hackerbay.io --from support@globalminimalism.com --server localhost \
  --port 2525 --auth-user user@hackerbay.io --auth-password hackerbay

```

Check the logs for running container and see if you get a mail in your inbox.
