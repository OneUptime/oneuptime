#!/usr/bin/env bash

set -e

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


if [[ ! $(which npm) && ! $(npm --version) ]]; then
    if [[ "$OSTYPE" != "darwin"* ]]; then
        echo "Setting up NPM"
        sudo apt-get install -y npm
    fi
fi

if [[ ! $(which ts-node) ]]; then
    sudo npm install -g ts-node
fi