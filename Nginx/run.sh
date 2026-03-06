#!/bin/bash

ORIGINAL_PROVISION_SSL="$PROVISION_SSL"

PRIMARY_DOMAIN=""
if [ -n "$HOST" ]; then
  PRIMARY_DOMAIN=$(printf '%s' "$HOST" | cut -d: -f1 | tr '[:upper:]' '[:lower:]')
fi

if [ -n "$PRIMARY_DOMAIN" ]; then
  export PRIMARY_DOMAIN
fi

# Detect the DNS resolver from /etc/resolv.conf for nginx.
# This works in both Docker (127.0.0.11) and Kubernetes (kube-dns IP).
NGINX_RESOLVER=$(grep -m1 '^nameserver' /etc/resolv.conf | awk '{print $2}')
if [ -z "$NGINX_RESOLVER" ]; then
  NGINX_RESOLVER="127.0.0.11"
fi
export NGINX_RESOLVER

if [ "$PROVISION_SSL" = "true" ]; then
  export PROVISION_SSL
else
  export PROVISION_SSL=""
fi

# Ensure nginx log destinations exist so nginx -t succeeds even before reloads.
mkdir -p /var/log/nginx
touch /var/log/nginx/access.log /var/log/nginx/error.log

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