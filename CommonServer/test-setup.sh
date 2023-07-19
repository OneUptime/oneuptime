#!/usr/bin/env bash

# Run database in docker-compose

cd ..
# Run Preinstall. 
npm run prerun
# Run Postgres
export $(grep -v '^#' config.env | xargs) && docker compose -f docker-compose.dev.yml up -e -d postgres