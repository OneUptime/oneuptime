#!/bin/bash

# Start the main app
node --require ts-node/register Index.ts &

# Start the accounts app
cd ./FeatureSet/Accounts && npm start &

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?