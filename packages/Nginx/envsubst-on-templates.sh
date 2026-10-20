#!/bin/sh

set -e

ME=$(basename $0)

PRIMARY_DOMAIN_LOWER=""
if [ -n "${PRIMARY_DOMAIN}" ]; then
  PRIMARY_DOMAIN_LOWER=$(printf '%s' "${PRIMARY_DOMAIN}" | tr '[:upper:]' '[:lower:]')
fi

SERVER_CERT_DIRECTORY="/etc/nginx/certs/ServerCerts"
SERVER_CERT_PATH=""
SERVER_CERT_KEY_PATH=""

if [ -n "${PRIMARY_DOMAIN_LOWER}" ]; then
  SERVER_CERT_PATH="${SERVER_CERT_DIRECTORY}/${PRIMARY_DOMAIN_LOWER}.crt"
  SERVER_CERT_KEY_PATH="${SERVER_CERT_DIRECTORY}/${PRIMARY_DOMAIN_LOWER}.key"
fi

ensure_placeholder_certificate() {
  cert_path="$1"
  key_path="$2"
  domain="$3"

  if [ -z "$cert_path" ] || [ -z "$key_path" ] || [ -z "$domain" ]; then
    return 1
  fi

  if [ -f "$cert_path" ] && [ -f "$key_path" ]; then
    return 0
  fi

  if ! command -v openssl >/dev/null 2>&1; then
    echo "$ME: ERROR: openssl not available; cannot generate placeholder certificate for '$domain'."
    return 1
  fi

  echo "$ME: Generating temporary self-signed certificate for '$domain' while awaiting ACME provisioning."

  tmp_dir=$(mktemp -d)
  if [ ! -d "$tmp_dir" ]; then
    echo "$ME: ERROR: unable to create temporary directory for placeholder certificate generation."
    return 1
  fi

  mkdir -p "$(dirname "$cert_path")"

  if ! openssl req -x509 -newkey rsa:2048 -nodes \
    -subj "/C=US/ST=CA/L=San Francisco/O=OneUptime/OU=Ingress/CN=${domain}" \
    -keyout "${tmp_dir}/placeholder.key" \
    -out "${tmp_dir}/placeholder.crt" \
    -days 3 >/dev/null 2>&1; then
      echo "$ME: ERROR: failed to generate placeholder certificate for '$domain'."
      rm -rf "$tmp_dir"
      return 1
  fi

  mv "${tmp_dir}/placeholder.crt" "$cert_path"
  mv "${tmp_dir}/placeholder.key" "$key_path"
  chmod 600 "$cert_path" "$key_path"
  rm -rf "$tmp_dir"

  return 0
}

# Listening on IPv6 as well as IPv4.
#
# The address the app counts a visitor by is the one this ingress accepts the
# connection from, so a visitor who comes over IPv6 has to reach it over IPv6.
# Where the ingress's network has IPv6 (Docker Compose with IPv6 turned on in
# docker-compose.override.yml, a dual-stack Kubernetes cluster), Docker and
# Kubernetes hand such a connection to the ingress over IPv6, with the
# visitor's own address, and only an ingress listening there accepts it. So
# unless NGINX_LISTEN_ADDRESS names the one address to listen on, every
# listen on 7849 and 7850 has an IPv6 twin on [::] (IPv6 only, next to the
# IPv4 one) whenever this kernel has IPv6 at all. On a network without IPv6
# the twin has nothing but ::1 to listen on, and nothing changes.
#
# A kernel without IPv6 (booted with ipv6.disable=1) has no
# /proc/net/if_inet6, and nginx could not open an IPv6 socket there: no twin.
NGINX_IPV6_SUPPORT_FILE="${NGINX_IPV6_SUPPORT_FILE:-/proc/net/if_inet6}"

if [ -z "${NGINX_LISTEN_ADDRESS}" ] && [ -f "${NGINX_IPV6_SUPPORT_FILE}" ]; then
  export NGINX_IPV6_LISTEN_DEFAULT_DIRECTIVE="    listen [::]:7849 default_server;"
  export NGINX_IPV6_LISTEN_SSL_DEFAULT_DIRECTIVE="    listen [::]:7850 ssl default_server;"
  export NGINX_IPV6_LISTEN_DIRECTIVE="    listen [::]:7849;"
  NGINX_IPV6_LISTEN_SSL_DIRECTIVE="    listen [::]:7850 ssl;"
else
  export NGINX_IPV6_LISTEN_DEFAULT_DIRECTIVE=""
  export NGINX_IPV6_LISTEN_SSL_DEFAULT_DIRECTIVE=""
  export NGINX_IPV6_LISTEN_DIRECTIVE=""
  NGINX_IPV6_LISTEN_SSL_DIRECTIVE=""
fi

# Prepare conditional SSL directives for templates that need them.
#
# NGINX_LISTEN_OPTIONS are options of the listening socket, which nginx takes
# once for each address and port: the template writes them on the
# default_server listen of 7849 and of 7850, so the primary's own listen on
# 7850 below carries none.
if [ -n "${PROVISION_SSL}" ]; then
  if [ -n "${SERVER_CERT_PATH}" ] && [ -n "${SERVER_CERT_KEY_PATH}" ]; then
    if ensure_placeholder_certificate "${SERVER_CERT_PATH}" "${SERVER_CERT_KEY_PATH}" "${PRIMARY_DOMAIN_LOWER}"; then
      export PROVISION_SSL_LISTEN_DIRECTIVE="    listen ${NGINX_LISTEN_ADDRESS}7850 ssl;"
      export PROVISION_SSL_IPV6_LISTEN_DIRECTIVE="${NGINX_IPV6_LISTEN_SSL_DIRECTIVE}"
      export PROVISION_SSL_CERTIFICATE_DIRECTIVE="    ssl_certificate ${SERVER_CERT_PATH};"
      export PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE="    ssl_certificate_key ${SERVER_CERT_KEY_PATH};"
    else
      echo "$ME: WARNING: failed to ensure placeholder certificate for '${PRIMARY_DOMAIN_LOWER}'. HTTPS directives disabled to keep nginx healthy."
      export PROVISION_SSL_LISTEN_DIRECTIVE=""
      export PROVISION_SSL_IPV6_LISTEN_DIRECTIVE=""
      export PROVISION_SSL_CERTIFICATE_DIRECTIVE=""
      export PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE=""
    fi
  else
    echo "$ME: WARNING: PRIMARY_DOMAIN not set; cannot enable HTTPS provisioning."
    export PROVISION_SSL_LISTEN_DIRECTIVE=""
    export PROVISION_SSL_IPV6_LISTEN_DIRECTIVE=""
    export PROVISION_SSL_CERTIFICATE_DIRECTIVE=""
    export PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE=""
  fi
else
  export PROVISION_SSL_LISTEN_DIRECTIVE=""
  export PROVISION_SSL_IPV6_LISTEN_DIRECTIVE=""
  export PROVISION_SSL_CERTIFICATE_DIRECTIVE=""
  export PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE=""
fi

auto_envsubst() {

  echo "$ME: Running auto_envsubst"

  local template_dir="${NGINX_ENVSUBST_TEMPLATE_DIR:-/etc/nginx/templates}"
  local suffix="${NGINX_ENVSUBST_TEMPLATE_SUFFIX:-.template}"
  local output_dir="${NGINX_ENVSUBST_OUTPUT_DIR:-/etc/nginx/conf.d}"

  local template defined_envs relative_path output_path subdir
  defined_envs=$(printf '${%s} ' $(env | cut -d= -f1))
  [ -d "$template_dir" ] || return 0
  if [ ! -w "$output_dir" ]; then
    echo "$ME: ERROR: $template_dir exists, but $output_dir is not writable"
    return 0
  fi
  find "$template_dir" -follow -type f -name "*$suffix" -print | while read -r template; do
    relative_path="${template#$template_dir/}"
    output_path="$output_dir/${relative_path%$suffix}"
    subdir=$(dirname "$relative_path")
    # create a subdirectory where the template file exists
    mkdir -p "$output_dir/$subdir"

    # Make a temp copy to allow conditional line removal
    tmpfile=$(mktemp)
    cp "$template" "$tmpfile"

    # If hash tuning envs are not set, remove their lines from the template
    if [ -z "${SERVER_NAMES_HASH_BUCKET_SIZE}" ]; then
      sed -i '/^[[:space:]]*server_names_hash_bucket_size[[:space:]]/d' "$tmpfile"
    fi
    if [ -z "${SERVER_NAMES_HASH_MAX_SIZE}" ]; then
      sed -i '/^[[:space:]]*server_names_hash_max_size[[:space:]]/d' "$tmpfile"
    fi

    # Upstream keepalive is off (docker-compose default): strip the upstream{}
    # pool blocks so nginx uses the resolver + per-request $backend_app path.
    if [ "${NGINX_UPSTREAM_KEEPALIVE}" != "true" ]; then
      sed -i '/# BEGIN upstream-keepalive/,/# END upstream-keepalive/d' "$tmpfile"
    fi

    echo "$ME: Running envsubst on $template to $output_path"
    envsubst "$defined_envs" < "$tmpfile" > "$output_path"
    rm -f "$tmpfile"
  done
}

# The primary server block's name: HOST without its port.
#
# nginx compares a server name with the Host a request names minus its port,
# so a name that keeps HOST's port never matches. HOST keeps one when people
# reach OneUptime on it (HOST=oneuptime.example.com:8080): the app builds its
# links with the port and drops it when it tells its own address from a status
# page's. Named by HOST itself, the primary server answered no request at all:
# every one fell to the status-page default_server, which does not route
# /identity, and signing up or in answered "Page not found - /identity/signup".
# Everything up to the first ":", the rule run.sh's PRIMARY_DOMAIN and the
# app's own host check use.
export HOST_WITHOUT_PORT="${HOST%%:*}"

# Upstream connection pooling (keepalive). When enabled, proxy_pass targets the
# named upstream{} pools (kept in the template above); the pool pins the backend
# to an address resolved once at load, which is only safe when that address is
# stable for the life of the process — true for a Kubernetes Service ClusterIP,
# not for a docker-compose container that can change IP. open-source nginx
# cannot combine an upstream{} keepalive pool with runtime DNS re-resolution, so
# when disabled we fall back to the resolver + per-request $backend_app variable
# already baked into the template. These target vars are single-line and safe
# for envsubst; the pool block itself is toggled by the sed removal above.
if [ "${NGINX_UPSTREAM_KEEPALIVE}" = "true" ]; then
  export BACKEND_APP_TARGET="http://backend_app"
  export BACKEND_APP_GRPC_TARGET="grpc://backend_app_grpc"
  export NGINX_UPSTREAM_KEEPALIVE_CONNECTIONS="${NGINX_UPSTREAM_KEEPALIVE_CONNECTIONS:-64}"
else
  export BACKEND_APP_TARGET="\$backend_app"
  export BACKEND_APP_GRPC_TARGET="\$backend_app_grpc"
fi

auto_envsubst

exit 0