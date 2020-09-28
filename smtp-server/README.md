# Haraka Docker Container for Fyipe

This is a simple SMTP server which is used to send bulk emails. This can be used to send email alerts to subscribers and team.

## Important

This will not work on your local machine because email sending is blocked by ISP. You need to run these on the server and test.

## Build Docker Container

```
docker build . -t haraka:latest
```

## Run a Docker Container

Run Redis

```
docker run -d -p 6379:6379 redis:latest
```

Run Fyipe Haraka Container: 

```
docker run -d -p 25:25 -e SMTP_USER="user@hackerbay.io" --net="host" -e SMTP_PASSWORD="hackerbay" -e SMTP_PORT="25"  haraka:latest
```

## Test

```
# Ubuntu
sudo apt-get update
sudo apt-get install swaks -y

# MacOS
brew install swaks

# Test
swaks --to nawazdhandala@outlook.com --from user@hackerbay.io --server localhost \
  --port 25 --auth-user user@hackerbay.io --auth-password hackerbay

```

See if you get a mail in your inbox. 