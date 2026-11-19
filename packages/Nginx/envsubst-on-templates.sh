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
# page's. Named by HOST itself, the primary server answered none of the
# requests people sent to HOST: they fell to the status-page default_server,
# which does not route /identity, and signing up or in answered
# "Page not found - /identity/signup".
#
# The port follows the one ":" of a name or an IPv4 address. An IPv6 address
# with a port is written in brackets ("[2001:db8::1]:8080"), and nginx keeps
# them when it reads such a Host: the server is named "[2001:db8::1]". Cut at
# its first ":" it was named "[2001", which no request names (#7889). An IPv6
# address without brackets has no port: all its colons are its own. The rule
# of run.sh's PRIMARY_DOMAIN, and of the app's (HostAddressUtil.stripPort in
# Common).
#
# Such a HOST never works (#8022): a browser names the address in brackets,
# which this server name never matches, and nginx answers 400 to a Host
# without them. npm start and the Helm chart refuse it before anything starts;
# a HOST that came another way (Compose run by hand, a deployment of one's
# own) is said here, in the ingress's log, and nginx starts as it did.
case "${HOST}" in
  \[*\]*) export HOST_WITHOUT_PORT="${HOST%%]*}]" ;;
  *:*:*)
    export HOST_WITHOUT_PORT="${HOST}"
    echo "$ME: WARNING: HOST is ${HOST}, an IPv6 address without brackets, so no browser can open OneUptime at it. Set HOST=[${HOST}], with any port after the brackets, such as [2001:db8::1]:8080."
    ;;
  *) export HOST_WITHOUT_PORT="${HOST%:*}" ;;
esac

# HOST's place in the primary server's name, after localhost and ingress
# (`server_name localhost ingress ${HOST_SERVER_NAME};` in the template):
# HOST without its port, or nothing when that is localhost or ingress, which
# the name lists already.
#
# A server name listed twice for one address and port draws a warning from
# nginx, once for each: under the default HOST=localhost the name read
# "localhost ingress localhost", and every start logged
# 'conflicting server name "localhost" on 0.0.0.0:7849, ignored' for 7849
# and 7850, IPv4 and IPv6: four warnings in every install's log, where a real
# problem was easy to miss (#8023). nginx ignored the second "localhost", so
# leaving it out changes nothing nginx routes. nginx reads server names in
# lower case, so "LOCALHOST" is "localhost" too.
HOST_WITHOUT_PORT_LOWER=$(printf '%s' "${HOST_WITHOUT_PORT}" | tr '[:upper:]' '[:lower:]')
case "${HOST_WITHOUT_PORT_LOWER}" in
  localhost | ingress) export HOST_SERVER_NAME="" ;;
  *) export HOST_SERVER_NAME="${HOST_WITHOUT_PORT}" ;;
esac

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

# HTTP/2 for HOST: NGINX_HTTP2, the primary server's `http2` directive.
#
# With PROVISION_SSL the primary serves HOST over HTTPS on 7850, and offers
# HTTP/2 there through ALPN. OTLP over gRPC to HOST needs it, as gRPC runs
# over HTTP/2 only; browsers and OTLP over HTTP work over HTTP/1.1 as well.
# Nothing else speaks HTTP/2: the status-page servers leave it off, and on
# 7849 their default server decides for every plaintext connection.
#
# NGINX_HTTP2=off turns it off for HOST, and changes nothing else. It is for
# an install that sends no OTLP over gRPC to HOST, when nginx fixes a
# vulnerability in HTTP/2 and OneUptime cannot be upgraded yet (nginx 1.30.7
# fixed two, CVE-2026-123007 and CVE-2026-123633: #9709, #9846). Upgrading is
# the fix. Set in config.env or the Helm chart's nginx.http2, it lasts
# through restarts and upgrades, where editing the rendered config did not.
#
# on, true, yes and 1 (in any case), or nothing, keep HTTP/2 on, as it always
# was; off, false, no and 0 turn it off. Anything else keeps it on, and says
# so here: the ingress has to start, and gRPC ingest must not stop on a typo.
# The script says when it is off, so the ingress's log shows the setting took.
nginx_http2_setting=$(printf '%s' "${NGINX_HTTP2}" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')
case "${nginx_http2_setting}" in
  "" | on | true | yes | 1) export NGINX_HTTP2="on" ;;
  off | false | no | 0) export NGINX_HTTP2="off" ;;
  *)
    echo "$ME: WARNING: NGINX_HTTP2 is \"${NGINX_HTTP2}\", which is neither on nor off, so HTTP/2 stays on. Set NGINX_HTTP2=off to turn it off."
    export NGINX_HTTP2="on"
    ;;
esac

if [ "${NGINX_HTTP2}" = "off" ]; then
  if [ -n "${PROVISION_SSL_LISTEN_DIRECTIVE}" ]; then
    echo "$ME: HTTP/2 is off for ${HOST_WITHOUT_PORT} (NGINX_HTTP2=off): OTLP over gRPC to it stops, and OTLP over HTTP and browsers keep working over HTTP/1.1."
  else
    echo "$ME: NGINX_HTTP2 is off, which changes nothing here: the ingress serves no HTTPS for HOST, and so speaks only HTTP/1.1 to it."
  fi
fi

auto_envsubst

exit 0