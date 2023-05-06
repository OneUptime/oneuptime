#!/usr/bin/env bash


# If its not environment IS_DOCKER then exit

if [[ $IS_DOCKER == "true" ]]
then
    echo "This script should run in the docker container."
else
    # Pull latest changes
    git pull
fi

set -e

bash ./Scripts/Bash/preinstall.sh

# Load env values from config.env
export $(grep -v '^#' config.env | xargs)

sudo docker compose pull

# Create database if it does not exists
sudo docker compose up -d postgres && sleep 30 && sudo docker compose exec postgres psql postgresql://$DATABASE_USERNAME:$DATABASE_PASSWORD@localhost:5432/postgres -c 'CREATE DATABASE oneuptimedb' || echo "Database already created" 

# Start all containers.
npm run start

bash ./Scripts/Bash/check-status.sh