#!/bin/sh
set -eu
export TMPDIR=/var/cache/nginx/fixture-tmp
mkdir -p "$TMPDIR"
export NGINX_RESOLVER="$(awk '/^nameserver / {print $2; exit}' /etc/resolv.conf)"
test -n "$NGINX_RESOLVER"
sh /etc/nginx/envsubst-on-templates.sh
exec nginx -g 'daemon off;'
