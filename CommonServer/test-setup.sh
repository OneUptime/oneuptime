#!/usr/bin/env bash

# Run database in docker-compose

cd ..
# Run Preinstall. 
npm run prerun
# Run Postgres
docker-compose up postgres -d