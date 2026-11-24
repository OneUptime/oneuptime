#!/bin/bash
set -e

echo "=========================================="
echo "  OneUptime XCP-ng Agent Installer"
echo "=========================================="
echo ""

# Check prerequisites
if ! command -v docker &> /dev/null; then
    echo "Error: Docker is not installed. Please install Docker first."
    exit 1
fi

if ! docker info &> /dev/null 2>&1; then
    echo "Error: Docker daemon is not running or you don't have permission to access it."
    echo "Try running with sudo or add your user to the docker group."
    exit 1
fi

if ! docker compose version &> /dev/null 2>&1; then
    echo "Error: Docker Compose v2 is not available. Please install the docker compose plugin."
    exit 1
fi

if ! command -v curl &> /dev/null; then
    echo "Error: curl is not installed. Please install curl first."
    exit 1
fi

# ----------------------------------------------------------------------------
# .env quoting — Docker Compose v2 (compose-go dotenv) rules
# ----------------------------------------------------------------------------
# Compose does NOT read .env the way a shell would echo it back:
#   - unquoted and double-quoted values get $VAR / ${VAR} interpolation
#     (an unknown $ecret silently becomes ""), a space followed by # starts a
#     comment in unquoted values, and surrounding whitespace is trimmed;
#   - single-quoted values are literal, but Compose never unescapes \' and
#     treats a closing quote preceded by a backslash as escaped, so a value
#     containing ' or ending in \ cannot be single-quoted;
#   - double-quoted values honour \\ and \" and write a literal $ as $$.
# The plugin's secret is whatever its owner typed, and a Xen Orchestra name
# can hold spaces and #, so every user-supplied value goes through this
# helper. It prefers the literal single-quoted form and falls back to the
# escaped double-quoted form only when single quotes cannot represent the
# value. Pure parameter expansion: the value never leaves this shell (no
# echo, no subprocess).
compose_env_quote() {
    local value="$1"
    case "$value" in
        *\'*|*\\)
            value="${value//\\/\\\\}"
            value="${value//\"/\\\"}"
            value="${value//\$/\$\$}"
            printf '"%s"' "$value"
            ;;
        *)
            printf "'%s'" "$value"
            ;;
    esac
}

# Read one variable back from an existing .env exactly as Compose would, so a
# re-run reuses what a previous run (or a hand edit) wrote: the last
# assignment wins, single quotes are literal, double quotes undo \\ \" and $$,
# and an unquoted value stops at " #" and is trimmed. Prints nothing when the
# variable is absent.
dotenv_get() {
    local name="$1" file="$2" raw="" value="" rest="" ch=""
    raw=$(grep "^[[:space:]]*$name=" "$file" 2>/dev/null | tail -1) || true
    [ -n "$raw" ] || return 0
    value="${raw#*=}"
    case "$value" in
        \'*\'*)
            value="${value#\'}"
            value="${value%%\'*}"
            ;;
        \"*\"*)
            value="${value#\"}"
            rest="$value"
            value=""
            while [ -n "$rest" ]; do
                ch="${rest:0:1}"
                if [ "$ch" = '\' ] && [ -n "${rest:1:1}" ] && [ "${rest:1:1}" != '$' ]; then
                    value="$value${rest:1:1}"
                    rest="${rest:2}"
                elif [ "$ch" = '$' ] && [ "${rest:1:1}" = '$' ]; then
                    value="$value\$"
                    rest="${rest:2}"
                elif [ "$ch" = '"' ]; then
                    break
                else
                    value="$value$ch"
                    rest="${rest:1}"
                fi
            done
            ;;
        *)
            value="${value%% #*}"
            value="${value#"${value%%[![:space:]]*}"}"
            value="${value%"${value##*[![:space:]]}"}"
            value="${value//\$\$/\$}"
            ;;
    esac
    printf '%s' "$value"
}

# ----------------------------------------------------------------------------
# $ in the secret — a second layer of escaping
# ----------------------------------------------------------------------------
# The collector resolves "${env:XO_OPENMETRICS_SECRET}" and then expands the
# RESULT once more: $$ becomes $, and ${NAME} / ${env:NAME} are replaced by
# another variable (measured on collector 0.165.0). So the container has to
# hold the secret with every $ doubled for Xen Orchestra to get it verbatim -
# `pa$$word` must reach the container as `pa$$$$word`. That is on top of the
# Compose quoting above. Every .env holds the secret that way: the ones this
# script writes say so on their first line, and the docs tell people writing
# one by hand to double every $. A re-run undoes exactly one level.
COLLECTOR_ESCAPE_MARKER="# XO_OPENMETRICS_SECRET is escaped for the collector: every \$ is written as \$\$."

collector_env_escape() {
    printf '%s' "${1//\$/\$\$}"
}

collector_env_unescape() {
    printf '%s' "${1//\$\$/\$}"
}

# Download an agent file, keeping a copy of the installed one when it holds
# edits. The docs ask for edits to these files (project labels, a second
# agent's container name), so a re-run — the upgrade path — must not discard
# them silently. What was installed is recorded (a sha256 per file in
# .agent-files.sha256), so a file that no longer matches its record was
# edited: it is kept as <file>.bak.<timestamp> and named at the end. A file
# that still matches is simply replaced, however much the new version
# changed (a collector pin bump changes both files). Without a record — no
# sha256 tool — any file that differs from the new download is kept, and
# said to differ rather than to be edited. The new file lands with the
# permissions curl -o would give it (the collector reads its config as a
# non-root user).
EDITED_FILES=()
DIFFERING_FILES=()

file_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d ' ' -f 1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d ' ' -f 1
    fi
}

download_agent_file() {
    local file="$1" dest="$2" tmp backup recorded current name
    name="${dest#"$INSTALL_DIR"/}"
    tmp="$(mktemp "$dest.download.XXXXXX")"
    fetch_agent_file "$file" "$tmp"
    chmod 0644 "$tmp"
    if [ -f "$dest" ] && ! cmp -s "$tmp" "$dest"; then
        recorded=""
        if [ -f "$AGENT_FILES_RECORD" ]; then
            recorded="$(awk -v name="$name" '$2 == name { sha = $1 } END { print sha }' "$AGENT_FILES_RECORD")"
        fi
        current="$(file_sha256 "$dest")"
        if [ -z "$recorded" ] || [ -z "$current" ]; then
            backup="$dest.bak.$(date +%Y%m%d%H%M%S)"
            cp -p "$dest" "$backup"
            DIFFERING_FILES+=("$backup")
        elif [ "$current" != "$recorded" ]; then
            backup="$dest.bak.$(date +%Y%m%d%H%M%S)"
            cp -p "$dest" "$backup"
            EDITED_FILES+=("$backup")
        fi
    fi
    mv -f "$tmp" "$dest"
    current="$(file_sha256 "$dest")"
    if [ -n "$current" ]; then
        printf '%s  %s\n' "$current" "$name" >> "$AGENT_FILES_RECORD.new"
    fi
}

# ----------------------------------------------------------------------------
# Xen Orchestra's address
# ----------------------------------------------------------------------------
# XO_URL is Xen Orchestra's address as a browser opens it:
# https://xo.example.com, https://10.0.0.5:8443, https://[fd00::5]. The
# collector reads its scheme (XO_SCHEME) and its host:port (XO_ADDRESS)
# apart, so they are worked out here and written to .env with it. Xen
# Orchestra serves /openmetrics at its root, so the URL has no path.
#
# parse_xo_url <url>: sets XO_SCHEME (https or http), XO_HOST (lower case,
# an IPv6 address without its brackets), XO_PORT (443 or 80 when the URL
# names none) and XO_ADDRESS (host:port, an IPv6 address in brackets), or
# says why the URL is not one and returns 1.
parse_xo_url() {
    local url="$1" scheme="" rest="" hostport="" after="" host="" port=""
    url="${url#"${url%%[![:space:]]*}"}"
    url="${url%"${url##*[![:space:]]}"}"
    if [ -z "$url" ]; then
        echo "Error: XO_URL is empty: set it to Xen Orchestra's address, e.g. https://xo.example.com"
        return 1
    fi
    case "$url" in
        *://*)
            scheme="$(printf '%s' "${url%%://*}" | tr '[:upper:]' '[:lower:]')"
            rest="${url#*://}"
            ;;
        *)
            scheme="https"
            rest="$url"
            ;;
    esac
    case "$scheme" in
        https|http) ;;
        *)
            echo "Error: XO_URL must start with https:// (or http:// in a lab), not $scheme://."
            return 1
            ;;
    esac
    hostport="${rest%%[/?#]*}"
    after="${rest#"$hostport"}"
    case "$after" in
        ""|"/") ;;
        *)
            echo "Error: XO_URL must be Xen Orchestra's address alone, without a path (\"$after\"),"
            echo "e.g. $scheme://xo.example.com: Xen Orchestra serves its metrics at /openmetrics on its own address."
            return 1
            ;;
    esac
    case "$hostport" in
        *@*)
            echo "Error: XO_URL must not hold a user name or password. The agent reads Xen Orchestra"
            echo "with the OpenMetrics plugin's secret alone (XO_OPENMETRICS_SECRET)."
            return 1
            ;;
    esac
    case "$hostport" in
        \[*\]:*)
            host="${hostport#\[}"
            host="${host%%\]*}"
            port="${hostport##*\]:}"
            ;;
        \[*\])
            host="${hostport#\[}"
            host="${host%\]}"
            ;;
        \[*|*\]*)
            echo "Error: XO_URL's address \"$hostport\" is not a host name or an IPv6 address in square brackets."
            return 1
            ;;
        *:*:*)
            echo "Error: write an IPv6 address in square brackets: $scheme://[$hostport]"
            return 1
            ;;
        *:*)
            host="${hostport%%:*}"
            port="${hostport#*:}"
            ;;
        *)
            host="$hostport"
            ;;
    esac
    if [ -z "$port" ]; then
        if [ "$scheme" = "https" ]; then
            port="443"
        else
            port="80"
        fi
    fi
    case "$port" in
        *[!0-9]*)
            echo "Error: XO_URL's port \"$port\" is not a number."
            return 1
            ;;
    esac
    port="$((10#$port))"
    if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
        echo "Error: XO_URL's port $port is not a port (1 to 65535)."
        return 1
    fi
    host="$(printf '%s' "$host" | tr '[:upper:]' '[:lower:]')"
    case "$hostport" in
        \[*)
            case "$host" in
                *:*) ;;
                *)
                    echo "Error: \"[$host]\" in XO_URL is not an IPv6 address."
                    return 1
                    ;;
            esac
            case "$host" in
                *[!0-9a-f:.]*)
                    echo "Error: \"[$host]\" in XO_URL is not an IPv6 address."
                    return 1
                    ;;
            esac
            XO_ADDRESS="[$host]:$port"
            ;;
        *)
            case "$host" in
                ""|-*|.*|*[!a-z0-9._-]*)
                    echo "Error: \"$host\" in XO_URL is not a host name or an IP address."
                    return 1
                    ;;
            esac
            XO_ADDRESS="$host:$port"
            ;;
    esac
    XO_SCHEME="$scheme"
    XO_HOST="$host"
    XO_PORT="$port"
}

# An IP address (IPv4, or IPv6 without brackets), not a name.
is_ip_address() {
    case "$1" in
        *:*) return 0 ;;
    esac
    printf '%s' "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$'
}

# The collector expands ${...} and $$ inside these values once more, and
# none of them ever needs a $: refuse one rather than ship a value the
# collector would rewrite.
reject_dollar() {
    case "$2" in
        *\$*)
            echo "Error: $1 must not contain a \$ character."
            exit 1
            ;;
    esac
}

# ----------------------------------------------------------------------------
# Xen Orchestra's certificate
# ----------------------------------------------------------------------------
# The collector checks Xen Orchestra's certificate against xo-ca.pem and
# nothing else, and never skips the check. xo-ca.pem is, in this order:
#   - XO_TLS_FINGERPRINT set: XO's own certificate, fetched here and kept
#     only when its SHA-256 fingerprint is the one given (pinned);
#   - XO_CA_FILE set: a copy of that CA bundle, once XO's certificate is
#     checked against it;
#   - neither: this machine's CA bundle, when this machine already trusts
#     XO's certificate (one a public CA, or a CA installed here, issued);
#   - otherwise the certificate's fingerprint is shown, and pinned once the
#     person at the terminal confirms it. With no one to ask, nothing is
#     trusted and the install stops.
# Like every current TLS client, the collector checks the certificate is
# issued to the name it connects to, and reads that name from the
# certificate's subjectAltName only (never its subject's CN): a certificate
# with no subjectAltName - the self-signed one Xen Orchestra makes for itself
# - can never be checked, pinned or not.

# Where the CA bundle of this machine is, as Go and OpenSSL look for it.
CA_BUNDLE_CANDIDATES="/etc/ssl/certs/ca-certificates.crt /etc/pki/tls/certs/ca-bundle.crt \
/etc/ssl/ca-bundle.pem /etc/pki/ca-trust/extracted/pem/tls-ca-bundle.pem /etc/ssl/cert.pem \
/etc/pki/tls/cacert.pem /usr/local/share/certs/ca-root-nss.crt"

# The address curl connects to: XO_ADDRESS's host, an IPv6 one in brackets.
xo_connect_host() {
    case "$XO_HOST" in
        *:*) printf '[%s]' "$XO_HOST" ;;
        *) printf '%s' "$XO_HOST" ;;
    esac
}

# xo_curl <ca-file or ""> <path> [curl arguments...]: a request to Xen
# Orchestra the way the collector makes it - to XO_ADDRESS, checking the
# certificate against <ca-file> (this machine's own trust when "") and
# against XO_TLS_SERVER_NAME when it is set.
xo_curl() {
    local cafile="$1" path="$2" url=""
    shift 2
    local -a args=(-sS --connect-timeout 10 --max-time 90)
    if [ -n "$cafile" ]; then
        args+=(--cacert "$cafile")
    fi
    if [ "$XO_SCHEME" = "https" ] && [ -n "$XO_TLS_SERVER_NAME" ]; then
        args+=(--connect-to "$XO_TLS_SERVER_NAME:$XO_PORT:$(xo_connect_host):$XO_PORT")
        url="https://$XO_TLS_SERVER_NAME:$XO_PORT$path"
    else
        url="$XO_SCHEME://$XO_ADDRESS$path"
    fi
    curl "${args[@]}" "$@" "$url"
}

# The certificate Xen Orchestra presents (the first of its chain), as PEM in
# $1. Read only to be looked at: nothing is trusted here.
fetch_xo_certificate() {
    local out="$1" sni="${XO_TLS_SERVER_NAME:-$XO_HOST}" limit=""
    local -a sni_args=()
    if ! is_ip_address "$sni"; then
        sni_args=(-servername "$sni")
    fi
    if command -v timeout >/dev/null 2>&1; then
        limit="timeout 20"
    fi
    $limit openssl s_client -connect "$XO_ADDRESS" ${sni_args[@]+"${sni_args[@]}"} </dev/null 2>/dev/null \
        | openssl x509 -outform PEM > "$out" 2>/dev/null
    [ -s "$out" ]
}

# A certificate's SHA-256 fingerprint as openssl prints it (AB:CD:...).
certificate_fingerprint() {
    local line=""
    line="$(openssl x509 -in "$1" -noout -fingerprint -sha256 2>/dev/null)" || return 1
    printf '%s' "${line#*=}" | tr '[:lower:]' '[:upper:]'
}

# A fingerprint as typed (colons, spaces, "sha256 Fingerprint=" or not) as
# 64 upper-case hex digits, or nothing when it is not a SHA-256 fingerprint.
normalize_fingerprint() {
    local value="$1"
    value="${value#*=}"
    value="$(printf '%s' "$value" | tr -d ': \t' | tr '[:lower:]' '[:upper:]')"
    if printf '%s' "$value" | grep -Eq '^[0-9A-F]{64}$'; then
        printf '%s' "$value"
    fi
}

# The names a certificate is issued to, as openssl lists its subjectAltName
# ("DNS:xo.example.com, IP Address:10.0.0.5"), or nothing.
certificate_names() {
    openssl x509 -in "$1" -noout -text 2>/dev/null \
        | awk '/X509v3 Subject Alternative Name/ { getline; sub(/^[[:space:]]+/, ""); print; exit }'
}

# Whether the certificate in $1 is issued to $2 (a name or an IP address),
# reading its subjectAltName alone, as the collector does.
certificate_matches() {
    local pem="$1" name="$2" out=""
    if is_ip_address "$name"; then
        out="$(openssl x509 -in "$pem" -noout -checkip "$name" 2>/dev/null)" || true
    else
        # Without a DNS name in the subjectAltName, openssl would fall back to
        # the subject's CN, which the collector never reads.
        case "$(certificate_names "$pem")" in
            *DNS:*) ;;
            *) return 1 ;;
        esac
        out="$(openssl x509 -in "$pem" -noout -checkhost "$name" 2>/dev/null)" || true
    fi
    case "$out" in
        *"does match"*) return 0 ;;
    esac
    return 1
}

# The first name (not a wildcard) a certificate's subjectAltName lists.
certificate_first_dns_name() {
    certificate_names "$1" | tr ',' '\n' \
        | sed -n 's/^[[:space:]]*DNS:\([^*[:space:]][^[:space:]]*\)[[:space:]]*$/\1/p' | head -1
}

describe_certificate() {
    local pem="$1"
    openssl x509 -in "$pem" -noout -subject -issuer -enddate 2>/dev/null | sed 's/^/    /'
    echo "    Names: $(certificate_names "$pem")"
    echo "    SHA-256 fingerprint: $(certificate_fingerprint "$pem")"
}

# This machine's CA bundle that verifies Xen Orchestra's certificate (or,
# with "any", the first one there is), or nothing.
find_ca_bundle() {
    local mode="$1" candidate=""
    for candidate in ${CURL_CA_BUNDLE:-} ${SSL_CERT_FILE:-} $CA_BUNDLE_CANDIDATES; do
        [ -f "$candidate" ] && [ -s "$candidate" ] || continue
        grep -q "BEGIN CERTIFICATE" "$candidate" 2>/dev/null || continue
        if [ "$mode" = "any" ] || xo_curl "$candidate" /openmetrics/health -o /dev/null 2>/dev/null; then
            printf '%s' "$candidate"
            return 0
        fi
    done
}

# Installation directory (decided first so an existing .env can be reused)
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-xcp-ng-agent}"
ENV_FILE="$INSTALL_DIR/.env"
# What this script installed (see download_agent_file).
AGENT_FILES_RECORD="$INSTALL_DIR/.agent-files.sha256"
# The certificates the collector trusts for Xen Orchestra.
CA_PEM="$INSTALL_DIR/xo-ca.pem"

# Every variable docker-compose.yml reads, and the three this script reads
# again on a re-run: XO_URL (XO_SCHEME and XO_ADDRESS come from it), and how
# Xen Orchestra's certificate is trusted (XO_TLS_FINGERPRINT, XO_CA_FILE),
# so an upgrade checks the certificate the same way.
ENV_NAMES="ONEUPTIME_URL ONEUPTIME_TELEMETRY_INGESTION_KEY XO_URL XO_SCHEME XO_ADDRESS \
XO_OPENMETRICS_SECRET XO_NAME XO_TLS_FINGERPRINT XO_CA_FILE XO_TLS_SERVER_NAME"

# Re-running the installer is the upgrade, and it keeps the existing
# configuration: every value already in .env is reused unless the same
# variable is exported in the shell, and nothing is prompted for again.
# Edit .env directly, export the variable, or delete the file to change one.
REUSED_ENV=0
if [ -f "$ENV_FILE" ]; then
    REUSED_ENV=1
    echo "Found an existing configuration in $ENV_FILE — reusing it."
    echo "(Exported variables override it; edit or delete the file to change a value.)"
    for name in $ENV_NAMES; do
        if [ -z "${!name}" ]; then
            printf -v "$name" '%s' "$(dotenv_get "$name" "$ENV_FILE")"
            # The secret is escaped for the collector in the file (an exported
            # value is always the secret as typed).
            if [ "$name" = "XO_OPENMETRICS_SECRET" ]; then
                printf -v "$name" '%s' "$(collector_env_unescape "${!name}")"
            fi
        fi
    done
    # An .env written by hand from the Docker Compose guide may give the
    # scheme and address without XO_URL.
    if [ -z "$XO_URL" ] && [ -n "$XO_ADDRESS" ]; then
        XO_URL="${XO_SCHEME:-https}://$XO_ADDRESS"
    fi
    echo ""
fi

# Prompt for configuration
if [ -z "$ONEUPTIME_URL" ]; then
    read -rp "OneUptime URL (e.g., https://oneuptime.com): " ONEUPTIME_URL
fi
# The collector appends /otlp itself.
ONEUPTIME_URL="${ONEUPTIME_URL%/}"

if [ -z "$ONEUPTIME_TELEMETRY_INGESTION_KEY" ]; then
    read -rp "OneUptime Telemetry Ingestion Key: " ONEUPTIME_TELEMETRY_INGESTION_KEY
fi

while [ -z "$XO_URL" ]; do
    read -rp "Xen Orchestra's address (e.g., https://xo.example.com or https://10.0.0.5:8443): " XO_URL
done
parse_xo_url "$XO_URL" || exit 1

while [ -z "$XO_OPENMETRICS_SECRET" ]; do
    # -s: never echo the secret to the terminal.
    read -rsp "OpenMetrics plugin secret (Xen Orchestra: Settings → Plugins → openmetrics): " XO_OPENMETRICS_SECRET
    echo ""
done

if [ -z "$XO_NAME" ]; then
    if [ "$REUSED_ENV" = 0 ]; then
        read -rp "What to call this Xen Orchestra in OneUptime [$XO_HOST]: " XO_NAME
    fi
    XO_NAME="${XO_NAME:-$XO_HOST}"
fi

reject_dollar XO_NAME "$XO_NAME"
# The collector stamps the name from inside an OTTL string, where a quote or
# a backslash would end or escape it.
case "$XO_NAME" in
    *\"*|*\\*)
        echo "Error: XO_NAME must not contain a double quote or a backslash."
        exit 1
        ;;
esac
reject_dollar XO_TLS_SERVER_NAME "$XO_TLS_SERVER_NAME"
reject_dollar ONEUPTIME_URL "$ONEUPTIME_URL"
# A CA bundle named from where the script was started is kept by its full
# path, so a re-run from anywhere finds it.
case "$XO_CA_FILE" in
    ""|/*) ;;
    *) XO_CA_FILE="$(pwd)/$XO_CA_FILE" ;;
esac
case "$XO_TLS_SERVER_NAME" in
    *[!A-Za-z0-9.-]*)
        echo "Error: XO_TLS_SERVER_NAME must be a host name, e.g. xo.example.com."
        exit 1
        ;;
esac
XO_TLS_SERVER_NAME="$(printf '%s' "$XO_TLS_SERVER_NAME" | tr '[:upper:]' '[:lower:]')"

# The collector runs in a container on Docker's bridge network: there,
# localhost is the container itself, never this machine.
case "$XO_HOST" in
    localhost|127.*|::1|0:0:0:0:0:0:0:1)
        echo "Warning: XO_URL names this machine's loopback ($XO_HOST). Inside the agent's container that is"
        echo "the container itself, so the agent cannot reach Xen Orchestra there. Use this machine's"
        echo "address on the network (or host.docker.internal on Docker Desktop) instead."
        echo ""
        ;;
esac

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
# The certificates to trust, once decided; "keep" keeps the installed ones.
TRUST_PEM=""
TRUST_MODE=""

echo "Checking Xen Orchestra at $XO_SCHEME://$XO_ADDRESS ..."
if [ "$XO_SCHEME" = "http" ]; then
    echo ""
    echo "WARNING: XO_URL uses http://. The OpenMetrics secret, and everything Xen Orchestra"
    echo "reports, cross the network in clear: use this only in a lab. Anywhere else, give"
    echo "Xen Orchestra a certificate and use https:// (see \"Xen Orchestra's certificate\" in"
    echo "the agent's README)."
    echo ""
    # The collector builds its TLS settings even for http://, so xo-ca.pem
    # must hold a certificate: this machine's CA bundle (never used over
    # http://), or the file XO_CA_FILE names.
    if [ -n "$XO_CA_FILE" ]; then
        TRUST_PEM="$XO_CA_FILE"
    else
        TRUST_PEM="$(find_ca_bundle any)"
    fi
    if [ -z "$TRUST_PEM" ] || ! grep -q "BEGIN CERTIFICATE" "$TRUST_PEM" 2>/dev/null; then
        echo "Error: the collector needs a CA bundle file even over http://, and this machine has none"
        echo "where it looks. Set XO_CA_FILE to any PEM certificate file and run this again."
        exit 1
    fi
    TRUST_MODE="http"
else
    if ! command -v openssl &> /dev/null; then
        echo "Error: openssl is not installed. It reads Xen Orchestra's certificate so the agent"
        echo "trusts it and nothing else. Please install openssl (e.g. apt install openssl) first."
        exit 1
    fi

    if [ -n "$XO_TLS_FINGERPRINT" ] && [ -z "$(normalize_fingerprint "$XO_TLS_FINGERPRINT")" ]; then
        echo "Error: XO_TLS_FINGERPRINT is not a SHA-256 fingerprint (64 hexadecimal digits, colons"
        echo "optional), as \`openssl x509 -noout -fingerprint -sha256\` prints it."
        exit 1
    fi

    LEAF_PEM="$WORK_DIR/xo-certificate.pem"
    if ! fetch_xo_certificate "$LEAF_PEM"; then
        if [ "$REUSED_ENV" = 1 ] && [ -s "$CA_PEM" ]; then
            echo "Warning: could not reach Xen Orchestra at $XO_ADDRESS to check its certificate."
            echo "Keeping the certificates the agent already trusts ($CA_PEM)."
            TRUST_MODE="keep"
        else
            echo "Error: could not read Xen Orchestra's certificate at $XO_ADDRESS: it does not answer"
            echo "over TLS from this machine. Check XO_URL, that Xen Orchestra is running, and that no"
            echo "firewall blocks port $XO_PORT."
            exit 1
        fi
    fi

    if [ "$TRUST_MODE" != "keep" ]; then
        # The name the certificate must be issued to.
        CERT_NAMES="$(certificate_names "$LEAF_PEM")"
        if [ -z "$CERT_NAMES" ]; then
            echo ""
            echo "Error: Xen Orchestra's certificate is issued to no name (it has no subjectAltName):"
            describe_certificate "$LEAF_PEM"
            echo "It is most likely the self-signed certificate Xen Orchestra makes for itself. The"
            echo "agent checks that a certificate is issued to the address it connects to, as every"
            echo "current TLS client does, so it cannot trust this one, pinned or not. Give Xen"
            echo "Orchestra a certificate that names its address - see \"Xen Orchestra's certificate\""
            echo "in the agent's README for the commands - then run this again."
            exit 1
        fi
        if [ -n "$XO_TLS_SERVER_NAME" ]; then
            if ! certificate_matches "$LEAF_PEM" "$XO_TLS_SERVER_NAME"; then
                echo "Error: Xen Orchestra's certificate is not issued to XO_TLS_SERVER_NAME ($XO_TLS_SERVER_NAME)."
                echo "It is issued to: $CERT_NAMES"
                echo "Set XO_TLS_SERVER_NAME to one of those names, or leave it empty, and run this again."
                exit 1
            fi
        elif ! certificate_matches "$LEAF_PEM" "$XO_HOST"; then
            XO_TLS_SERVER_NAME="$(certificate_first_dns_name "$LEAF_PEM")"
            if [ -z "$XO_TLS_SERVER_NAME" ]; then
                echo "Error: Xen Orchestra's certificate is not issued to $XO_HOST, the address in XO_URL."
                echo "It is issued to: $CERT_NAMES"
                echo "Use one of those addresses in XO_URL and run this again."
                exit 1
            fi
            echo "Xen Orchestra's certificate is not issued to $XO_HOST but to $XO_TLS_SERVER_NAME: the"
            echo "agent connects to $XO_ADDRESS and checks the certificate against $XO_TLS_SERVER_NAME"
            echo "(XO_TLS_SERVER_NAME)."
        fi

        # A certificate that expired is refused by the collector, pinned or not.
        if ! openssl x509 -in "$LEAF_PEM" -noout -checkend 0 >/dev/null 2>&1; then
            echo "Error: Xen Orchestra's certificate has expired:"
            describe_certificate "$LEAF_PEM"
            echo "The agent refuses an expired certificate. Renew it on Xen Orchestra and run this again."
            exit 1
        fi
        if ! openssl x509 -in "$LEAF_PEM" -noout -checkend 2592000 >/dev/null 2>&1; then
            echo "Warning: Xen Orchestra's certificate expires within 30 days ($(openssl x509 -in "$LEAF_PEM" -noout -enddate 2>/dev/null | sed 's/^notAfter=//'))."
            echo "The agent stops reading Xen Orchestra when it does, until it is renewed."
        fi

        SEEN_FINGERPRINT="$(certificate_fingerprint "$LEAF_PEM")"
        if [ -n "$XO_TLS_FINGERPRINT" ]; then
            if [ "$(normalize_fingerprint "$XO_TLS_FINGERPRINT")" != "$(normalize_fingerprint "$SEEN_FINGERPRINT")" ]; then
                echo ""
                echo "Error: Xen Orchestra's certificate is NOT the one XO_TLS_FINGERPRINT pins."
                echo "  XO_TLS_FINGERPRINT:    $XO_TLS_FINGERPRINT"
                echo "  Xen Orchestra presents: $SEEN_FINGERPRINT"
                describe_certificate "$LEAF_PEM"
                echo "Something between this machine and Xen Orchestra may be intercepting the connection,"
                echo "or Xen Orchestra's certificate changed (renewed, or made again when it expired). Check"
                echo "the fingerprint on Xen Orchestra's machine:"
                echo "  openssl x509 -noout -fingerprint -sha256 -in <the certificate xo-server uses>"
                echo "and, if it is Xen Orchestra's, set XO_TLS_FINGERPRINT to it and run this again."
                exit 1
            fi
            TRUST_PEM="$LEAF_PEM"
            TRUST_MODE="pinned"
            echo "Xen Orchestra's certificate matches XO_TLS_FINGERPRINT: the agent trusts it, and only it."
        elif [ -n "$XO_CA_FILE" ]; then
            if [ ! -r "$XO_CA_FILE" ] || ! grep -q "BEGIN CERTIFICATE" "$XO_CA_FILE" 2>/dev/null; then
                echo "Error: XO_CA_FILE ($XO_CA_FILE) is not a readable PEM CA bundle."
                exit 1
            fi
            if ! CHECK_ERROR="$(xo_curl "$XO_CA_FILE" /openmetrics/health -o /dev/null 2>&1)"; then
                echo "Error: Xen Orchestra's certificate does not check out against XO_CA_FILE ($XO_CA_FILE):"
                echo "  ${CHECK_ERROR}"
                describe_certificate "$LEAF_PEM"
                exit 1
            fi
            TRUST_PEM="$XO_CA_FILE"
            TRUST_MODE="ca-file"
            echo "Xen Orchestra's certificate checks out against XO_CA_FILE: the agent trusts that CA bundle."
        else
            TRUST_PEM="$(find_ca_bundle verify)"
            if [ -n "$TRUST_PEM" ]; then
                TRUST_MODE="system"
                echo "This machine trusts Xen Orchestra's certificate: the agent trusts the same CA bundle ($TRUST_PEM)."
            else
                echo ""
                echo "This machine does not trust Xen Orchestra's certificate (self-signed, or from a CA"
                echo "installed nowhere here):"
                describe_certificate "$LEAF_PEM"
                echo ""
                echo "Check the fingerprint on Xen Orchestra's machine before you trust it:"
                echo "  openssl x509 -noout -fingerprint -sha256 -in <the certificate xo-server uses>"
                if [ -t 0 ]; then
                    read -rp "Is it the same? Trust this certificate, and only it? [y/N]: " TRUST_ANSWER || TRUST_ANSWER=""
                    if [[ "$TRUST_ANSWER" =~ ^[Yy] ]]; then
                        XO_TLS_FINGERPRINT="$SEEN_FINGERPRINT"
                        TRUST_PEM="$LEAF_PEM"
                        TRUST_MODE="pinned"
                        echo "Pinned: XO_TLS_FINGERPRINT=$XO_TLS_FINGERPRINT"
                    else
                        echo "Not trusted: nothing was installed. Set XO_CA_FILE to the CA bundle that issued it,"
                        echo "or XO_TLS_FINGERPRINT to the fingerprint you checked, and run this again."
                        exit 1
                    fi
                else
                    echo "Nobody is at a terminal to confirm it, so nothing is trusted and nothing was"
                    echo "installed. Once you have checked it, run this again with"
                    echo "  XO_TLS_FINGERPRINT=$SEEN_FINGERPRINT"
                    echo "or with XO_CA_FILE set to the CA bundle that issued it."
                    exit 1
                fi
            fi
        fi
    fi
fi

# The secret, asked of Xen Orchestra the way the collector asks: on its
# metrics endpoint, with the certificates just decided. It reaches curl on
# stdin, never on its command line.
if [ "$TRUST_MODE" = "keep" ]; then
    echo "Warning: not checking the OpenMetrics secret: Xen Orchestra does not answer."
else
    METRICS_BODY="$WORK_DIR/metrics"
    PROBE_CA=""
    if [ "$TRUST_MODE" != "http" ]; then
        PROBE_CA="$TRUST_PEM"
    fi
    METRICS_CODE="$(printf 'Authorization: Bearer %s\n' "$XO_OPENMETRICS_SECRET" \
        | xo_curl "$PROBE_CA" /openmetrics/metrics \
            -H @- -o "$METRICS_BODY" -w '%{http_code}' 2>"$WORK_DIR/curl-error")" || true
    case "$METRICS_CODE" in
        200)
            if grep -q "^xcp_pool_connected{" "$METRICS_BODY" 2>/dev/null; then
                POOL_COUNT="$(grep -c "^xcp_pool_connected{" "$METRICS_BODY" || true)"
                POOL_NAMES="$(sed -n 's/^xcp_pool_connected{.*pool_name="\([^"]*\)".*/\1/p' "$METRICS_BODY" \
                    | sed 's/^$/(a pool with no name)/' | paste -sd, - | sed 's/,/, /g')"
                echo "Xen Orchestra accepts the secret and reports $POOL_COUNT pool(s): $POOL_NAMES"
            elif grep -q "No connected hosts" "$METRICS_BODY" 2>/dev/null; then
                echo "Xen Orchestra accepts the secret, but is connected to no pool yet: each pool appears"
                echo "in OneUptime once Xen Orchestra is connected to it."
            else
                echo "Error: $XO_SCHEME://$XO_ADDRESS/openmetrics/metrics answered, but not with Xen Orchestra's"
                echo "metrics. Check XO_URL is Xen Orchestra's own address."
                exit 1
            fi
            ;;
        401)
            echo ""
            if grep -q "does not match" "$METRICS_BODY" 2>/dev/null; then
                echo "Error: Xen Orchestra refused the secret: it is not the OpenMetrics plugin's secret."
            else
                echo "Error: Xen Orchestra refused the request: no secret reached it."
            fi
            echo "Copy the secret from Xen Orchestra (Settings → Plugins → openmetrics), set"
            echo "XO_OPENMETRICS_SECRET to it (or run this again with an empty one to be asked), and run"
            echo "this again."
            exit 1
            ;;
        500|502|503|404)
            echo "Error: Xen Orchestra answers, but its OpenMetrics plugin does not (HTTP $METRICS_CODE)."
            echo "Turn the plugin on in Xen Orchestra (Settings → Plugins → openmetrics; an XOA needs a"
            echo "Premium licence for it, Xen Orchestra built from sources includes it). The agent needs"
            echo "Xen Orchestra 6.9 or later."
            exit 1
            ;;
        *)
            if [ "$REUSED_ENV" = 1 ] && [ -s "$CA_PEM" ] && [ "$TRUST_MODE" != "http" ]; then
                echo "Warning: could not ask Xen Orchestra for its metrics ($(head -c 300 "$WORK_DIR/curl-error"))."
                echo "Continuing with the configuration in $ENV_FILE."
            else
                echo "Error: could not ask Xen Orchestra for its metrics at $XO_SCHEME://$XO_ADDRESS/openmetrics/metrics:"
                echo "  $(head -c 300 "$WORK_DIR/curl-error") (HTTP ${METRICS_CODE:-000})"
                exit 1
            fi
            ;;
    esac
fi

# Create installation directory
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# ----------------------------------------------------------------------------
# Where the agent's files come from
# ----------------------------------------------------------------------------
# The OneUptime this agent reports to serves the files of its own release,
# and this script, at <ONEUPTIME_URL>/install/<agent>, so the agent always
# matches its OneUptime. A OneUptime older than that answers with a 404 or a
# page of its own instead: the files then come from GitHub, as this script
# downloaded them before. Any other answer (none at all, a server error)
# stops the install, and every file must arrive as plain text, wherever it
# comes from. Every agent's install.sh has this same block.
AGENT_FILES_PATH="install/xcp-ng-agent"
AGENT_FILES_ON_GITHUB="https://raw.githubusercontent.com/OneUptime/oneuptime/main/agents/XcpNgAgent"
AGENT_FILES_URL=""
AGENT_FILE_ANSWER=""

# download_agent_text <url> <destination>: true when the URL answers 200 with
# plain text; AGENT_FILE_ANSWER holds its status and content type either way.
download_agent_text() {
    AGENT_FILE_ANSWER="$(curl -sSL -o "$2" -w '%{http_code} %{content_type}' "$1")" || AGENT_FILE_ANSWER="000"
    case "$AGENT_FILE_ANSWER" in
        "200 text/plain"*) return 0 ;;
        *) return 1 ;;
    esac
}

# fetch_agent_file <file> <destination>: one of the agent's files, from
# where the first one came from.
fetch_agent_file() {
    if [ -z "$AGENT_FILES_URL" ]; then
        AGENT_FILES_URL="${ONEUPTIME_URL%/}/$AGENT_FILES_PATH"
        if download_agent_text "$AGENT_FILES_URL/$1" "$2"; then
            return 0
        fi
        case "$AGENT_FILE_ANSWER" in
            "404 "* | "200 "*)
                echo "$ONEUPTIME_URL does not serve the agent's files: it runs a OneUptime older"
                echo "than this installer. Downloading them from GitHub instead."
                AGENT_FILES_URL="$AGENT_FILES_ON_GITHUB"
                if download_agent_text "$AGENT_FILES_URL/$1" "$2"; then
                    return 0
                fi
                ;;
        esac
    elif download_agent_text "$AGENT_FILES_URL/$1" "$2"; then
        return 0
    fi
    rm -f "$2"
    case "$AGENT_FILE_ANSWER" in
        000*) echo "Error: could not reach $AGENT_FILES_URL/$1" ;;
        *) echo "Error: $AGENT_FILES_URL/$1 answered ${AGENT_FILE_ANSWER%% *}, not the file" ;;
    esac
    exit 1
}

# Download configuration files
echo "Downloading configuration files..."
rm -f "$AGENT_FILES_RECORD.new"
download_agent_file "docker-compose.yml" "$INSTALL_DIR/docker-compose.yml"
download_agent_file "otel-collector-config.yaml" "$INSTALL_DIR/otel-collector-config.yaml"
# The record now describes the files just installed (none without a sha256
# tool: a stale one would read the new files as edited next time).
if [ -f "$AGENT_FILES_RECORD.new" ]; then
    mv -f "$AGENT_FILES_RECORD.new" "$AGENT_FILES_RECORD"
else
    rm -f "$AGENT_FILES_RECORD"
fi

# The certificates the collector trusts for Xen Orchestra. Public
# certificates only, so readable by the collector's non-root user.
if [ "$TRUST_MODE" != "keep" ] && [ "$TRUST_PEM" != "$CA_PEM" ]; then
    cp "$TRUST_PEM" "$CA_PEM.new"
    chmod 0644 "$CA_PEM.new"
    mv -f "$CA_PEM.new" "$CA_PEM"
fi

# Create .env file. It holds the OpenMetrics secret, so it is created
# owner-read-only before anything is written to it. Every user-supplied
# value is quoted for Compose (see compose_env_quote), and the secret also
# escaped for the collector (see collector_env_escape); the scheme is a
# validated shape and stays bare.
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
cat > "$ENV_FILE" <<ENVEOF
$COLLECTOR_ESCAPE_MARKER
ONEUPTIME_URL=$(compose_env_quote "$ONEUPTIME_URL")
ONEUPTIME_TELEMETRY_INGESTION_KEY=$(compose_env_quote "$ONEUPTIME_TELEMETRY_INGESTION_KEY")
XO_URL=$(compose_env_quote "$XO_URL")
XO_SCHEME=$XO_SCHEME
XO_ADDRESS=$(compose_env_quote "$XO_ADDRESS")
XO_OPENMETRICS_SECRET=$(compose_env_quote "$(collector_env_escape "$XO_OPENMETRICS_SECRET")")
XO_NAME=$(compose_env_quote "$XO_NAME")
XO_TLS_FINGERPRINT=$(compose_env_quote "$XO_TLS_FINGERPRINT")
XO_CA_FILE=$(compose_env_quote "$XO_CA_FILE")
XO_TLS_SERVER_NAME=$(compose_env_quote "$XO_TLS_SERVER_NAME")
ENVEOF
chmod 600 "$ENV_FILE"

# Start the agent
echo ""
echo "Starting OneUptime XCP-ng Agent..."
cd "$INSTALL_DIR"
# Compose gives variables in its environment precedence over .env, and this
# script's variables are exported whenever the user exported them to answer
# a prompt. Hand Compose none of them, so this start runs exactly what every
# later `docker compose up` (and the systemd unit) will: .env alone.
for name in $ENV_NAMES; do
    export -n "$name"
done
# Pull first, so a re-run also moves an image whose tag does not change. A
# failed pull (a host without registry access, its images loaded by hand) is
# not fatal: `up` still pulls any image this machine does not have.
if ! docker compose pull; then
    echo "Warning: could not pull the latest images; starting with the ones this machine has."
fi
# --force-recreate, because running this again on an installed agent is how
# it picks up new files: Compose recreates a running container only when its
# service definition or environment changed, never for a new
# otel-collector-config.yaml or xo-ca.pem (bind mounts), and the collector
# reads them only when it starts. A plain `up -d` would keep the old config
# — and the old oneuptime.agent.version — running after the new one arrived.
if ! docker compose up -d --force-recreate; then
    echo ""
    echo "Error: the agent did not start. If Docker reports that the container name"
    echo "\"oneuptime-xcp-ng-agent\" is already in use, another Xen Orchestra's agent runs on"
    echo "this machine: give this one its own container_name in $INSTALL_DIR/docker-compose.yml"
    echo "(see README.md, \"Reading several Xen Orchestras\") and run: cd $INSTALL_DIR && docker compose up -d"
    exit 1
fi

echo ""
echo "=========================================="
echo "  OneUptime XCP-ng Agent is running!"
echo "=========================================="
echo ""
echo "Every pool Xen Orchestra ($XO_NAME) manages appears under XCP-ng in OneUptime"
echo "after the first scrape (about a minute)."
case "$TRUST_MODE" in
    pinned) echo "Xen Orchestra's certificate is pinned (XO_TLS_FINGERPRINT); when it is renewed, run this again." ;;
    ca-file) echo "Xen Orchestra's certificate is checked against XO_CA_FILE ($XO_CA_FILE)." ;;
    system) echo "Xen Orchestra's certificate is checked against this machine's CA bundle." ;;
    http) echo "Reading Xen Orchestra over http:// - in clear. Use https:// anywhere but a lab." ;;
esac
if [ "${#EDITED_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "You had edited these files since install.sh installed them. They were replaced by"
    echo "the current versions; your copies are kept next to them:"
    for backup in "${EDITED_FILES[@]}"; do
        echo "  $backup"
    done
    echo "Re-apply your changes to the new files, then: cd $INSTALL_DIR && docker compose up -d --force-recreate"
fi
if [ "${#DIFFERING_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "These files differ from the new versions and were replaced. There was no record of"
    echo "what install.sh had installed, so they may hold changes of yours; the old copies are"
    echo "kept next to them:"
    for backup in "${DIFFERING_FILES[@]}"; do
        echo "  $backup"
    done
    echo "If they do, re-apply your changes to the new files, then: cd $INSTALL_DIR && docker compose up -d --force-recreate"
fi
echo ""
echo "To check status:  cd $INSTALL_DIR && docker compose ps"
echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
echo "To upgrade:       run this installer again; it reuses $ENV_FILE"
echo "If nothing shows up: curl -fsSL $AGENT_FILES_URL/troubleshoot.sh | bash -s -- -d $INSTALL_DIR"
