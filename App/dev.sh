
#!/bin/bash

# Start the main app
node --inspect=0.0.0.0:9229 --require ts-node/register Index.ts & 

# Start the accounts app
cd ./FeatureSet/Accounts && npm run dev &

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?