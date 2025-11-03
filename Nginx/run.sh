#!/bin/bash

ORIGINAL_PROVISION_SSL="$PROVISION_SSL"

PRIMARY_DOMAIN=""
if [ -n "$HOST" ]; then
  PRIMARY_DOMAIN=$(printf '%s' "$HOST" | cut -d: -f1 | tr '[:upper:]' '[:lower:]')
fi

if [ -n "$PRIMARY_DOMAIN" ]; then
  export PRIMARY_DOMAIN
fi

if [ "$PROVISION_SSL" = "true" ]; then
  export PROVISION_SSL
else
  export PROVISION_SSL=""
fi

# Run envsubst on template
/etc/nginx/envsubst-on-templates.sh

# Restore environment variables for subsequent processes
if [ -n "$PRIMARY_DOMAIN" ]; then
  unset PRIMARY_DOMAIN
fi

if [ -n "$ORIGINAL_PROVISION_SSL" ]; then
  export PROVISION_SSL="$ORIGINAL_PROVISION_SSL"
else
  unset PROVISION_SSL
fi

# Start the first process
nginx -c /etc/nginx/nginx.conf -g "daemon off;" &

# Start the second process
npm start &

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?