#!/bin/bash

# Start the first process
nginx -c /etc/nginx/nginx.conf -g "daemon off;" &

# Start the second process
npm start &

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?