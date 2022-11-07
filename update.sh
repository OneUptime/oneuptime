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

cd oneuptime
git pull
cd ../

rm -f docker-compose.yml
cp oneuptime/docker-compose.yml docker-compose.yml.tmpl
envsubst < docker-compose.yml.tmpl > docker-compose.yml
rm docker-compose.yml.tmpl

docker-compose pull

echo "Stopping the stack!"
docker-compose stop

echo "Checking if async migrations are up to date"
sudo -E docker-compose run init



echo "OK, Restarting the stack!"
sudo -E docker-compose up -d


echo "OneUptime upgraded successfully!"