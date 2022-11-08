#!/usr/bin/env bash

set -e

export ONEUPTIME_APP_TAG="${ONEUPTIME_APP_TAG:-latest}"

ONEUPTIME_SECRET=$(head -c 28 /dev/urandom | sha224sum -b | head -c 56)
export ONEUPTIME_SECRET

# Talk to the user
echo "Welcome to the single instance OneUptime 🟢 installer"
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

# If docker-compose is installed and if docker-compose.yml is found then, stop the stack.
if [[ $(which docker-compose) ]]; then
if [ -f ./docker-compose.yml ]; then
sudo -E docker-compose -f docker-compose.yml stop || true
fi
fi


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

# clone oneuptime
echo "Installing OneUptime 🟢"
if [[ ! $(which git) ]]; then
if [[ "$OSTYPE" != "darwin"* ]]; then
sudo apt install -y git
fi
if [[ "$OSTYPE" == "darwin"* ]]; then
brew install git
fi
fi

GIT_REPO_URL=$(git config --get remote.origin.url)
if [[ $GIT_REPO_URL != *oneuptime.git ]] # * is used for pattern matching
then
  git clone https://github.com/OneUptime/oneuptime.git || true
  cd oneuptime
fi

# try to clone - if folder is already there pull latest for that branch
git pull
cd ..

if [[ ! $(which node) && ! $(node --version) ]]; then
    if [[ "$OSTYPE" != "darwin"* ]]; then
        echo "Setting up NodeJS"
        sudo apt-get install -y nodejs
        sudo apt-get install -y npm
    fi

    if [[ "$OSTYPE" == "darwin"* ]]; then
        brew install nodejs
    fi
fi


if [[ "$OSTYPE" == "darwin"* ]]; then
brew install gomplate
fi

if [[ "$OSTYPE" != "darwin"* ]]; then
sudo apt-get install -y gomplate
fi


cd oneuptime

# Create .env file if it does not exist. 
touch config.env

#Run a scirpt to merge config.env.tpl to config.env
node ./Scripts/Install/MergeEnvTemplate.js


echo "Config file has been generated at config.env. Please look at the config, make changes and when you're done - hit enter to continue with the setup."
read -r ENTER


# Load env values from config.env
export $(grep -v '^#' config.env | xargs)

# Write env vars in config files. 

for d in */ ; do
    if [ -f /$d/.env.tpl ]; then
        cat /$d/.env.tpl | gomplate > /$d/.env
    fi
done

# Write this to docker-compose. 
cat docker-compose.yml.tpl | gomplate > docker-compose.yml