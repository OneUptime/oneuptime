#!/bin/sh

set -e

ME=$(basename $0)

PRIMARY_DOMAIN_LOWER=""
PRIMARY_DOMAIN_LOG_LABEL="primary-domain-not-set"
if [ -n "${PRIMARY_DOMAIN}" ]; then
  PRIMARY_DOMAIN_LOWER=$(printf '%s' "${PRIMARY_DOMAIN}" | tr '[:upper:]' '[:lower:]')
  PRIMARY_DOMAIN_LOG_LABEL="${PRIMARY_DOMAIN_LOWER}"
fi

SERVER_CERT_DIRECTORY="/etc/nginx/certs/ServerCerts"
SERVER_CERT_PATH=""
SERVER_CERT_KEY_PATH=""

if [ -n "${PRIMARY_DOMAIN_LOWER}" ]; then
  SERVER_CERT_PATH="${SERVER_CERT_DIRECTORY}/${PRIMARY_DOMAIN_LOWER}.crt"
  SERVER_CERT_KEY_PATH="${SERVER_CERT_DIRECTORY}/${PRIMARY_DOMAIN_LOWER}.key"
fi

# Prepare conditional SSL directives for templates that need them.
if [ -n "${PROVISION_SSL}" ]; then
  if [ -n "${SERVER_CERT_PATH}" ] && [ -f "${SERVER_CERT_PATH}" ] && [ -f "${SERVER_CERT_KEY_PATH}" ]; then
    export PROVISION_SSL_LISTEN_DIRECTIVE="    listen ${NGINX_LISTEN_ADDRESS}7850 ssl ${NGINX_LISTEN_OPTIONS};"
    export PROVISION_SSL_CERTIFICATE_DIRECTIVE="    ssl_certificate ${SERVER_CERT_PATH};"
    export PROVISION_SSL_CERTIFICATE_KEY_DIRECTIVE="    ssl_certificate_key ${SERVER_CERT_KEY_PATH};"
  else
    echo "$ME: SSL provisioning enabled but certificate not yet available for '${PRIMARY_DOMAIN_LOG_LABEL}'. Skipping HTTPS directives until certificate exists."
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