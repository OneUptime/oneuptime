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

# sed all of these values
sed -i 's/.*SUBSCRIPTION_PLAN_BASIC.*/SUBSCRIPTION_PLAN_BASIC=Free,price_1M4niQANuQdJ93r7AVjhnik5,price_1M4niQANuQdJ93r7l1Wz1dkm,0,0,1,0/' config.env
sed -i 's/.*SUBSCRIPTION_PLAN_GROWTH.*/SUBSCRIPTION_PLAN_GROWTH=Growth,price_1M4nhZANuQdJ93r7yfQ1MePQ,price_1M4r3OANuQdJ93r7g8NyoCBq,22,20,2,14/' config.env
sed -i 's/.*SUBSCRIPTION_PLAN_SCALE.*/SUBSCRIPTION_PLAN_SCALE=Scale,price_1MKidGANuQdJ93r7FoaZ1dOb,price_1MKidRANuQdJ93r7LVOc0BUy,99,84,3,14/' config.env
sed -i 's/.*SUBSCRIPTION_PLAN_ENTERPRISE.*/SUBSCRIPTION_PLAN_ENTERPRISE=Enterprise,price_1M4ng9ANuQdJ93r7CP90ezSN,price_1M4ng9ANuQdJ93r72ZYUp4PU,-1,-1,4,14/' config.env

sed -i 's/.*BILLING_PUBLIC_KEY.*/BILLING_PUBLIC_KEY=pk_test_51LleTZANuQdJ93r7PvyfOvpm5TZXtUf1T5fjS5cbOmDuCFIiGMoEhvuIrzTRMcZirg7qJwgbjLeCmXmxL1BiUDi100IzcuP3SU/' config.env
sed -i 's/.*BILLING_PUBLIC_KEY.*/BILLING_PUBLIC_KEY=$TEST_BILLING_PRIVATE_KEY/' config.env

# print config.env file
echo "config.env file"
cat config.env

export $(grep -v '^#' config.env | xargs) 

# print env vars
echo "env vars"
printenv

docker compose -f docker-compose.dev.yml up -d postgres redis