#!/usr/bin/env bash

set -e

bash ./Scripts/Install/generate-secrets.sh

# Talk to the user
echo "Welcome to the OneUptime 🟢 Runner"
echo ""
echo "⚠️  You really need 8gb or more of memory to run this stack ⚠️"
echo ""
echo ""

echo "Please enter your sudo password now:"
sudo echo ""
echo "Thanks! 🙏"
echo ""
echo "Ok! We'll take it from here 🚀"

echo "Making sure any stack that might exist is stopped"


# If Mac
if [[ "$OSTYPE" == "darwin"* ]]; then
    if [[ ! $(which brew) ]]; then
        echo "Homebrew not installed. Please install homebrew and restart installer"
        exit
    fi
fi

# If linux
if [[ "$OSTYPE" != "darwin"* ]]; then
    echo "Grabbing latest apt caches"
    sudo apt update
fi

echo "Installing OneUptime 🟢"

bash ./Scripts/Install/install-git.sh

if [[ $IS_DOCKER == "true" ]]
then
    echo "This script should run in the docker container."
else
    GIT_REPO_URL=$(git config --get remote.origin.url)

    if [[ $GIT_REPO_URL != *oneuptime* ]] # * is used for pattern matching
    then
        git clone https://github.com/OneUptime/oneuptime.git || true
        cd oneuptime
    fi
fi


# if this script is not running in CI/CD
if [ -z "$CI_PIPELINE_ID" ]
then
    if [[ $IS_DOCKER == "true" ]]
    then
        echo "Running in docker container. Skipping git pull."
    else
        git pull
    fi
fi


bash ./Scripts/Install/install-node.sh

bash ./Scripts/Install/install-docker.sh

bash ./Scripts/Install/install-gomplate.sh

# Generate Self Signed SSL certificate. 
bash ./Scripts/Install/generate-certs.sh

# Generate env files from env templates.
bash ./Scripts/Install/generate-env-files.sh  