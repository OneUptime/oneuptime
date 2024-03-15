#!/bin/bash

# This script will have these arguments --secret-key=904c9500-e2b5-11ee-879c-8d06c4e2b5df --oneuptime-url=https://test.oneuptime.com

SECRET_KEY=""
ONEUPTIME_URL=""

for i in "$@"
do
case $i in
    --secret-key=*)
    SECRET_KEY="${i#*=}"
    shift # past argument=value
    ;;
    --oneuptime-url=*)
    ONEUPTIME_URL="${i#*=}"
    shift # past argument=value
    ;;
    *)
          # unknown option
    ;;
esac
done

if [ -z "$SECRET_KEY" ]; then
    echo "Secret key is required."
    exit 1
fi

if [ -z "$ONEUPTIME_URL" ]; then
    echo "Oneuptime URL is required. Example: https://oneuptime.com"
    exit 1
fi

# Install NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash


# Install latest Node.js via NVM
nvm install node

# Make this nodejs version the default
nvm alias default node

# Now install 
npm install -g ts-node @oneuptime/infrastructure-agent

# Run the agent
oneuptime-infrastructure-agent --secret-key=$SECRET_KEY --oneuptime-url=$ONEUPTIME_URL

# This scrpt will be hosted on github, to use it, you can run the following command
# curl -s https://raw.githubusercontent.com/OneUptime/oneuptime/release/InfrastructureAgent/Scripts/Install/Linux.sh | bash -s -- --secret-key=904c9500-e2b5-11ee-879c-8d06c4e2b5df --oneuptime-url=https://test.oneuptime.com
```