#!/usr/bin/env bash


# If its not environment IS_DOCKER then exit

if [[ $IS_DOCKER == "true" ]]
then
    echo "This script should run in the docker container."
else
    # Pull latest changes
    git pull
fi

set -a

bash configure.sh

# Load env values from config.env
export $(grep -v '^#' config.env | xargs) && docker compose pull

# Start all containers.
npm start

