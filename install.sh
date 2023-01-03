#!/usr/bin/env bash

set -e

bash preinstall.sh

# Pull latest changes
git pull

sudo docker compose pull


# Create database if it does not exists
sudo docker compose up -d postgres && sleep 30 && sudo docker compose exec postgres psql postgresql://$DATABASE_USERNAME:$DATABASE_PASSWORD@localhost:5432/postgres -c 'CREATE DATABASE oneuptimedb' || echo "Database created" 

# Start all containers.
npm run start

echo "We will need to wait ~5-10 minutes for things to settle down, migrations to finish, and TLS certs to be issued"
echo ""
echo "⏳ Waiting for OneUptime to boot (this will take a few minutes)"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/api/status)" != "200" ]]; do sleep 5; done'
echo "Progress 1/10"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/dashboard/status)" != "200" ]]; do sleep 5; done'
echo "Progress 2/10"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/file/status)" != "200" ]]; do sleep 5; done'
echo "Progress 3/10"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/status-page/status)" != "200" ]]; do sleep 5; done'
echo "Progress 4/10"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/status)" != "200" ]]; do sleep 5; done'
echo "Progress 5/10"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/accounts/status)" != "200" ]]; do sleep 5; done'
echo "Progress 6/10"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/mail/status)" != "200" ]]; do sleep 5; done'
echo "Progress 7/10"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/workers/status)" != "200" ]]; do sleep 5; done'
echo "Progress 8/10"
bash -c 'while [[ "$(curl -s -o /dev/null -w ''%{http_code}'' localhost/identity/status)" != "200" ]]; do sleep 5; done'
echo "Progress 9/10"
echo "⌛️ OneUptime is up!"
echo ""
echo "🎉🎉🎉  Done! 🎉🎉🎉"

echo "We would like to hear your feedback to make this product better for you and for other users, please email us at hello@oneuptime.com."
echo " - If you notice a bug, we will fix it for you."
echo " - If you need a feature, we will add that to the roadmap and let you know the estimated time to ship."
echo "We would love to hear your feedback. Email: hello@oneuptime.com"