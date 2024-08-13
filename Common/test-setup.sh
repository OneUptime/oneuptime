#!/usr/bin/env bash

# Run database in docker-compose

cd ..
# Run Preinstall. 
npm run prerun
# Run Postgres

# Change all of the following env vars in config.env

# process.env['NODE_ENV'] = 'test';

# process.env['BILLING_ENABLED'] = 'true';

# process.env['DATABASE_HOST'] = 'localhost';
# process.env['DATABASE_PORT'] = '5400';

# process.env['REDIS_HOST'] = 'localhost';
# process.env['REDIS_PORT'] = '6379';
# process.env['REDIS_DB'] = '0';
# process.env['REDIS_USERNAME'] = 'default';

# Using sed

sed -i 's/.*NODE_ENV.*/NODE_ENV=test/' config.env
sed -i 's/.*BILLING_ENABLED.*/BILLING_ENABLED=true/' config.env
sed -i 's/.*DATABASE_HOST.*/DATABASE_HOST=localhost/' config.env
sed -i 's/.*DATABASE_PORT.*/DATABASE_PORT=5400/' config.env
sed -i 's/.*REDIS_HOST.*/REDIS_HOST=localhost/' config.env
sed -i 's/.*REDIS_PORT.*/REDIS_PORT=6310/' config.env
sed -i 's/.*REDIS_DB.*/REDIS_DB=0/' config.env
sed -i 's/.*REDIS_USERNAME.*/REDIS_USERNAME=default/' config.env

# print config.env file
echo "config.env file"
cat config.env

export $(grep -v '^#' config.env | xargs) 

# print env vars
echo "env vars"
printenv

docker compose -f docker-compose.dev.yml up -d postgres redis