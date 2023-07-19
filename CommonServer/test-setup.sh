#!/usr/bin/env bash

# Run database in docker-compose

cd ..
# Run Preinstall. 
npm run prerun
# Run Postgres
docker compose --env-file config.env up -f docker-compose.dev.yml -e  -d postgres