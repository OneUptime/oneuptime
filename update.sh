#!/usr/bin/env bash

set -e

echo "Updating OneUptime. This will cause a few minutes of downtime. If you would like to avoid downtime, please consider installing this on a Kubernetes cluster."
read -r -p "Do you want to update OneUptime? [y/N] " response
if [[ "$response" =~ ^([yY][eE][sS]|[yY])+$ ]]
then
    echo "OK!"
else
    exit
fi

bash preinstall.sh

# Revert all local changes
git reset
git checkout .

# Pull latest changes
git pull

docker-compose pull

echo "Stopping the stack!"
docker-compose stop

# echo "Checking if async migrations are up to date"
# sudo -E docker-compose run init

echo "OK, Restarting the stack!"
npm run start


echo "OneUptime updated successfully!"