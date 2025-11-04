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

# Prepare conditional SSL directives for templates that need them.
if [ -n "${PROVISION_SSL}" ]; then
  if [ -n "${SERVER_CERT_PATH}" ] && [ -n "${SERVER_CERT_KEY_PATH}" ]; then
    if ensure_placeholder_certificate "${SERVER_CERT_PATH}" "${SERVER_CERT_KEY_PATH}" "${PRIMARY_DOMAIN_LOWER}"; then
      export PROVISION_SSL_LISTEN_DIRECTIVE="    listen ${NGINX_LISTEN_ADDRESS}7850 ssl ${NGINX_LISTEN_OPTIONS};"
      export PROVISION_SSL_CERTIFICATE_DIRECTIVE="    ssl_certificate ${SERVER_CERT_PATH};"
      export PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE="    ssl_certificate_key ${SERVER_CERT_KEY_PATH};"
    else
      echo "$ME: WARNING: failed to ensure placeholder certificate for '${PRIMARY_DOMAIN_LOWER}'. HTTPS directives disabled to keep nginx healthy."
      export PROVISION_SSL_LISTEN_DIRECTIVE=""
      export PROVISION_SSL_CERTIFICATE_DIRECTIVE=""
      export PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE=""
    fi
  else
    echo "$ME: WARNING: PRIMARY_DOMAIN not set; cannot enable HTTPS provisioning."
    export PROVISION_SSL_LISTEN_DIRECTIVE=""
    export PROVISION_SSL_CERTIFICATE_DIRECTIVE=""
    export PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE=""
  fi
else
  export PROVISION_SSL_LISTEN_DIRECTIVE=""
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

    echo "$ME: Running envsubst on $template to $output_path"
    envsubst "$defined_envs" < "$tmpfile" > "$output_path"
    rm -f "$tmpfile"
  done
}

auto_envsubst

exit 0