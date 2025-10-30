#!/bin/bash

if [ "${ENABLE_SSL_PROVIONING_FOR_ONEUPTIME}" = "true" ] && [ -n "${HOST}" ]; then
	ONEUPTIME_SSL_LISTEN_DIRECTIVES=$(cat <<'EOF'
		listen ${NGINX_LISTEN_ADDRESS}7850 ssl http2 ${NGINX_LISTEN_OPTIONS};
EOF
)

	ONEUPTIME_SSL_CERT_DIRECTIVES=$(cat <<'EOF'
		ssl_certificate /etc/nginx/certs/OneUptime/$ssl_server_name.crt;
		ssl_certificate_key /etc/nginx/certs/OneUptime/$ssl_server_name.key;
		ssl_protocols TLSv1.2 TLSv1.3;
		ssl_prefer_server_ciphers off;
EOF
)

	ONEUPTIME_SSL_REDIRECT_SNIPPET=$(cat <<'EOF'
				if ($scheme = "http") {
						return 301 https://$host$request_uri;
				}
EOF
)
else
	export ONEUPTIME_SSL_LISTEN_DIRECTIVES=""
	export ONEUPTIME_SSL_CERT_DIRECTIVES=""
	export ONEUPTIME_SSL_REDIRECT_SNIPPET=""
fi

export ONEUPTIME_SSL_LISTEN_DIRECTIVES
export ONEUPTIME_SSL_CERT_DIRECTIVES
export ONEUPTIME_SSL_REDIRECT_SNIPPET

# Run envsubst on template
/etc/nginx/envsubst-on-templates.sh

# Start the first process
nginx -c /etc/nginx/nginx.conf -g "daemon off;" &

# Start the second process
npm start &

# Wait for any process to exit
wait -n

# Exit with status of process that exited first
exit $?