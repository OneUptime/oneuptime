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
NGINX_PID=$!

# Start the second process
npm start &
NODE_PID=$!

# Forward container termination to both children. Without this trap, SIGTERM
# stops at this wrapper (it is PID 1) and neither child is ever notified: nginx
# drops in-flight requests and the Node sidecar is SIGKILLed at the end of the
# grace period with its Postgres pool still open.
#
# nginx needs SIGQUIT, not SIGTERM: SIGTERM is nginx's *fast* shutdown, which
# closes connections immediately. SIGQUIT is the graceful one -- it finishes
# in-flight requests and then exits.
term_handler() {
  kill -QUIT "$NGINX_PID" 2>/dev/null
  kill -TERM "$NODE_PID" 2>/dev/null
  wait "$NGINX_PID" 2>/dev/null
  wait "$NODE_PID" 2>/dev/null
  exit 0
}
trap term_handler TERM INT

# Wait for any process to exit. On SIGTERM this `wait -n` is interrupted and
# term_handler runs instead, draining both children before exiting.
wait -n

# Exit with status of process that exited first
exit $?