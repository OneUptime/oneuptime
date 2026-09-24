#!/bin/bash
set -e

echo "=========================================="
echo "  OneUptime Database Agent Installer"
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
# Database passwords routinely contain $, #, spaces and quotes, so every
# user-supplied value goes through this helper. It prefers the literal
# single-quoted form and falls back to the escaped double-quoted form only
# when single quotes cannot represent the value. Pure parameter expansion:
# the value never leaves this shell (no echo, no subprocess).
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

# Prompt until a non-empty answer arrives. Stops the installer instead of
# looping forever when stdin is closed (a non-interactive run that did not
# export the variable).
prompt_required() {
    local name="$1" question="$2" answer=""
    while [ -z "$answer" ]; do
        if ! read -rp "$question" answer; then
            echo ""
            echo "Error: $name is required. Export it (or add it to .env) for a non-interactive install."
            exit 1
        fi
    done
    printf -v "$name" '%s' "$answer"
}

# Map what people type (and what applications report) to the four engines
# this agent ships a config for. Prints nothing for anything else.
normalize_engine() {
    local raw
    raw="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
    case "$raw" in
        postgresql|postgres|pg|pgsql) printf 'postgresql' ;;
        mysql|mariadb|percona) printf 'mysql' ;;
        redis|valkey) printf 'redis' ;;
        mongodb|mongo) printf 'mongodb' ;;
        *) ;;
    esac
}

default_port_for() {
    case "$1" in
        postgresql) printf '5432' ;;
        mysql) printf '3306' ;;
        redis) printf '6379' ;;
        mongodb) printf '27017' ;;
    esac
}

# A host that only means something relative to the machine it is used on.
# OneUptime never registers a database under one of these, so it cannot be
# the database's identity.
is_local_only_host() {
    local host
    host="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    case "$host" in
        ""|localhost|*.localhost|127.*|::1|"[::1]"|0.0.0.0|::|"(local)"|.) return 0 ;;
        host.docker.internal|host.containers.internal|gateway.docker.internal) return 0 ;;
        docker.for.mac.localhost|kubernetes.docker.internal) return 0 ;;
        *) return 1 ;;
    esac
}

# A name OneUptime cannot tell apart from the same name in another network:
# a private or CGNAT IPv4 address, an IPv6 unique-local address, a
# single-label name or a Kubernetes cluster-local name. Such an identity only
# joins a database that already has it as an endpoint (or the one
# DATABASE_SERVER_ID names); it never registers a database on its own.
is_network_local_name() {
    local host octet1 octet2
    host="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
    if [[ "$host" =~ ^([0-9]+)\.([0-9]+)\.[0-9]+\.[0-9]+$ ]]; then
        octet1="${BASH_REMATCH[1]}"
        octet2="${BASH_REMATCH[2]}"
        [ "$octet1" -eq 10 ] && return 0
        [ "$octet1" -eq 172 ] && [ "$octet2" -ge 16 ] && [ "$octet2" -le 31 ] && return 0
        [ "$octet1" -eq 192 ] && [ "$octet2" -eq 168 ] && return 0
        [ "$octet1" -eq 100 ] && [ "$octet2" -ge 64 ] && [ "$octet2" -le 127 ] && return 0
        return 1
    fi
    case "$host" in
        f[cd]*:*) return 0 ;;
        *:*) return 1 ;;
        *.cluster.local|*.svc|*.svc.*) return 0 ;;
        *.*) return 1 ;;
        *) return 0 ;;
    esac
}

is_valid_port() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
    esac
    [ "$1" -ge 1 ] && [ "$1" -le 65535 ]
}

# Installation directory (decided first so an existing .env can be reused).
# One agent monitors ONE database: install a second copy with a different
# INSTALL_DIR for a second database.
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-database-agent}"
ENV_FILE="$INSTALL_DIR/.env"

ENV_NAMES="ONEUPTIME_URL ONEUPTIME_TELEMETRY_INGESTION_KEY DATABASE_SYSTEM \
DATABASE_ENDPOINT DATABASE_SERVER_ADDRESS DATABASE_SERVER_PORT \
DATABASE_USERNAME DATABASE_PASSWORD DATABASE_TLS_INSECURE \
DATABASE_TLS_INSECURE_SKIP_VERIFY DATABASE_COLLECTION_INTERVAL \
DATABASE_QUERY_EVENTS DATABASE_SERVER_ID"

# Re-running the installer (e.g. to pick up a new collector pin) keeps the
# existing configuration: every value already in .env is reused unless the
# same variable is exported in the shell, and nothing is prompted for again.
# Edit .env directly, export the variable, or delete the file to change one.
if [ -f "$ENV_FILE" ]; then
    echo "Found an existing configuration in $ENV_FILE — reusing it."
    echo "(Exported variables override it; edit or delete the file to change a value.)"
    for name in $ENV_NAMES; do
        if [ -z "${!name}" ]; then
            printf -v "$name" '%s' "$(dotenv_get "$name" "$ENV_FILE")"
        fi
    done
    # An optional value that was deliberately left empty stays empty on a
    # re-run instead of being asked for again.
    REUSING_ENV_FILE="true"
    echo ""
fi

# Prompt for configuration
if [ -z "$ONEUPTIME_URL" ]; then
    prompt_required ONEUPTIME_URL "OneUptime URL (e.g., https://oneuptime.com): "
fi
ONEUPTIME_URL="${ONEUPTIME_URL%/}"

if [ -z "$ONEUPTIME_TELEMETRY_INGESTION_KEY" ]; then
    prompt_required ONEUPTIME_TELEMETRY_INGESTION_KEY "OneUptime Telemetry Ingestion Key: "
fi

if [ -z "$DATABASE_SYSTEM" ]; then
    prompt_required DATABASE_SYSTEM "Database engine (postgresql, mysql, redis, mongodb): "
fi
ENGINE="$(normalize_engine "$DATABASE_SYSTEM")"
if [ -z "$ENGINE" ]; then
    echo "Error: '$DATABASE_SYSTEM' is not an engine this agent ships a config for."
    echo "Supported: postgresql (postgres), mysql (mariadb), redis (valkey), mongodb (mongo)."
    echo "Other engines still appear in OneUptime from your applications' traces and from"
    echo "Kubernetes / Docker auto-detection — see https://oneuptime.com/docs/telemetry/databases"
    exit 1
fi
DATABASE_SYSTEM="$ENGINE"
DEFAULT_PORT="$(default_port_for "$DATABASE_SYSTEM")"

if [ -z "$DATABASE_ENDPOINT" ]; then
    echo ""
    echo "Where the agent connects. When the agent runs on the database machine, use"
    echo "host.docker.internal:$DEFAULT_PORT (or localhost:$DEFAULT_PORT with network_mode: host)."
    prompt_required DATABASE_ENDPOINT "Database endpoint to connect to (host:port, e.g. db.internal:$DEFAULT_PORT): "
fi
# Be forgiving: strip a scheme and a trailing slash, and add the engine's
# default port when only a host was given.
DATABASE_ENDPOINT="${DATABASE_ENDPOINT#*://}"
DATABASE_ENDPOINT="${DATABASE_ENDPOINT%/}"
case "$DATABASE_ENDPOINT" in
    \[*\]:*) ;;
    \[*\]) DATABASE_ENDPOINT="$DATABASE_ENDPOINT:$DEFAULT_PORT" ;;
    *:*:*) DATABASE_ENDPOINT="[$DATABASE_ENDPOINT]:$DEFAULT_PORT" ;;
    *:*) ;;
    *) DATABASE_ENDPOINT="$DATABASE_ENDPOINT:$DEFAULT_PORT" ;;
esac
ENDPOINT_PORT="${DATABASE_ENDPOINT##*:}"
ENDPOINT_HOST="${DATABASE_ENDPOINT%:*}"
ENDPOINT_HOST="${ENDPOINT_HOST#[}"
ENDPOINT_HOST="${ENDPOINT_HOST%]}"
if ! is_valid_port "$ENDPOINT_PORT"; then
    echo "Error: '$DATABASE_ENDPOINT' does not end in a valid port (1-65535)."
    exit 1
fi

# The identity. It defaults to the endpoint the agent connects to, unless
# that endpoint is local to this machine — then the name applications use
# is the only thing that can identify the database, so it is asked for.
if [ -z "$DATABASE_SERVER_ADDRESS" ]; then
    if is_local_only_host "$ENDPOINT_HOST"; then
        echo ""
        echo "The endpoint '$DATABASE_ENDPOINT' only means something on this machine."
        echo "OneUptime identifies the database by the host name your APPLICATIONS use to reach it."
        prompt_required DATABASE_SERVER_ADDRESS "Database host name as applications see it (e.g. db.internal): "
    else
        DATABASE_SERVER_ADDRESS="$ENDPOINT_HOST"
    fi
fi
# Accept host:port here too, and split it.
case "$DATABASE_SERVER_ADDRESS" in
    \[*\]:*)
        [ -n "$DATABASE_SERVER_PORT" ] || DATABASE_SERVER_PORT="${DATABASE_SERVER_ADDRESS##*:}"
        DATABASE_SERVER_ADDRESS="${DATABASE_SERVER_ADDRESS%:*}"
        ;;
    *:*:*) ;;
    *:*)
        [ -n "$DATABASE_SERVER_PORT" ] || DATABASE_SERVER_PORT="${DATABASE_SERVER_ADDRESS##*:}"
        DATABASE_SERVER_ADDRESS="${DATABASE_SERVER_ADDRESS%:*}"
        ;;
esac
DATABASE_SERVER_ADDRESS="${DATABASE_SERVER_ADDRESS#[}"
DATABASE_SERVER_ADDRESS="${DATABASE_SERVER_ADDRESS%]}"
DATABASE_SERVER_ADDRESS="$(printf '%s' "$DATABASE_SERVER_ADDRESS" | tr '[:upper:]' '[:lower:]')"
if is_local_only_host "$DATABASE_SERVER_ADDRESS"; then
    echo "Error: DATABASE_SERVER_ADDRESS='$DATABASE_SERVER_ADDRESS' is local to one machine and cannot"
    echo "identify a database. Use the host name your applications connect to (e.g. db.internal)."
    exit 1
fi

if [ -z "$DATABASE_SERVER_PORT" ]; then
    DATABASE_SERVER_PORT="$ENDPOINT_PORT"
fi
if ! is_valid_port "$DATABASE_SERVER_PORT"; then
    echo "Error: DATABASE_SERVER_PORT='$DATABASE_SERVER_PORT' is not a valid port (1-65535)."
    exit 1
fi

if [ -z "$DATABASE_USERNAME" ]; then
    case "$DATABASE_SYSTEM" in
        postgresql|mysql)
            # Both receivers refuse to start without a login, so this is
            # asked for even on a re-run that found it empty.
            prompt_required DATABASE_USERNAME "Monitoring user (see the README for the grants it needs): "
            ;;
        *)
            if [ -z "$REUSING_ENV_FILE" ]; then
                read -rp "Monitoring user (leave empty if the server has no users/ACLs): " DATABASE_USERNAME || true
            fi
            ;;
    esac
fi

if [ -z "$DATABASE_PASSWORD" ] && [ -z "$REUSING_ENV_FILE" ]; then
    # -s: never echo the password to the terminal (or into shell history
    # of a pasted session transcript). Any character is fine — the value is
    # quoted for Docker Compose when .env is written below.
    read -rsp "Password for the monitoring user (leave empty for none): " DATABASE_PASSWORD || true
    echo ""
fi
if [ "$DATABASE_SYSTEM" = "postgresql" ] && [ -z "$DATABASE_PASSWORD" ]; then
    echo "Error: the PostgreSQL receiver refuses to start without a password (DATABASE_PASSWORD)."
    echo "Give the monitoring user a password (see the README)."
    exit 1
fi
if [ "$DATABASE_SYSTEM" = "mongodb" ] && [ -n "$DATABASE_USERNAME" ] && [ -z "$DATABASE_PASSWORD" ]; then
    echo "Error: MongoDB needs DATABASE_PASSWORD when DATABASE_USERNAME is set."
    exit 1
fi

if [ -z "$DATABASE_TLS_INSECURE" ]; then
    read -rp "Connect to the database over TLS? [y/N]: " USE_TLS || true
    if [[ "$USE_TLS" =~ ^[Yy] ]]; then
        DATABASE_TLS_INSECURE="false"
    else
        DATABASE_TLS_INSECURE="true"
    fi
fi

if [ -z "$DATABASE_TLS_INSECURE_SKIP_VERIFY" ]; then
    DATABASE_TLS_INSECURE_SKIP_VERIFY="false"
    if [ "$DATABASE_TLS_INSECURE" = "false" ]; then
        read -rp "Skip TLS certificate verification (self-signed or private CA)? [y/N]: " SKIP_VERIFY || true
        if [[ "$SKIP_VERIFY" =~ ^[Yy] ]]; then
            DATABASE_TLS_INSECURE_SKIP_VERIFY="true"
        fi
    fi
fi

if [ -z "$DATABASE_COLLECTION_INTERVAL" ]; then
    DATABASE_COLLECTION_INTERVAL="30s"
fi

if [ -z "$DATABASE_QUERY_EVENTS" ]; then
    DATABASE_QUERY_EVENTS="false"
    if [ "$DATABASE_SYSTEM" != "redis" ] && [ -z "$REUSING_ENV_FILE" ]; then
        read -rp "Also ship query samples and top queries (they contain query text)? [y/N]: " QUERY_EVENTS || true
        if [[ "$QUERY_EVENTS" =~ ^[Yy] ]]; then
            DATABASE_QUERY_EVENTS="true"
        fi
    fi
fi

# These go into the collector config unquoted (booleans) or as a duration,
# so a typo would stop the collector from starting. Refuse it here instead.
for name in DATABASE_TLS_INSECURE DATABASE_TLS_INSECURE_SKIP_VERIFY DATABASE_QUERY_EVENTS; do
    case "${!name}" in
        true|false) ;;
        *)
            echo "Error: $name must be true or false (got '${!name}')."
            exit 1
            ;;
    esac
done
if ! [[ "$DATABASE_COLLECTION_INTERVAL" =~ ^[0-9]+(ms|s|m|h)$ ]]; then
    echo "Error: DATABASE_COLLECTION_INTERVAL must be a duration such as 30s or 1m (got '$DATABASE_COLLECTION_INTERVAL')."
    exit 1
fi
# A private IP, a single-label name or a cluster-local name never registers
# a database on its own (the same name means a different server in another
# network), so without DATABASE_SERVER_ID the data only lands on a database
# that already has this endpoint. Say so now rather than leave an empty
# Databases list to explain it.
if [ -z "$DATABASE_SERVER_ID" ] && is_network_local_name "$DATABASE_SERVER_ADDRESS"; then
    echo ""
    echo "'$DATABASE_SERVER_ADDRESS' is only unique inside one network (a private IP, a single-label"
    echo "name or a Kubernetes cluster-local name), so OneUptime will not create a database from it."
    echo "The data joins a database that already has $DATABASE_SERVER_ADDRESS:$DATABASE_SERVER_PORT as an"
    echo "endpoint (Databases -> Create Database), or the one whose id you give here (its"
    echo "Documentation tab shows it)."
    if [ -z "$REUSING_ENV_FILE" ]; then
        read -rp "Database id from OneUptime (leave empty to create the database yourself): " DATABASE_SERVER_ID || true
    fi
fi

# The id of an existing OneUptime database is a UUID; anything else would be
# ignored by OneUptime, so catch the typo now.
if [ -n "$DATABASE_SERVER_ID" ] && ! [[ "$DATABASE_SERVER_ID" =~ ^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$ ]]; then
    echo "Error: DATABASE_SERVER_ID must be the database's id from OneUptime (a UUID), got '$DATABASE_SERVER_ID'."
    exit 1
fi

# Create installation directory
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR/systemd"

# Download configuration files. The collector config is the one for the
# chosen engine, saved under the name docker-compose.yml mounts.
REPO_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/DatabaseAgent"

echo "Downloading configuration files ($DATABASE_SYSTEM)..."
curl -fsSL "$REPO_BASE/docker-compose.yml" -o "$INSTALL_DIR/docker-compose.yml"
curl -fsSL "$REPO_BASE/configs/$DATABASE_SYSTEM.yaml" -o "$INSTALL_DIR/otel-collector-config.yaml"
curl -fsSL "$REPO_BASE/systemd/oneuptime-database-agent.service" -o "$INSTALL_DIR/systemd/oneuptime-database-agent.service"

# Create .env file. It holds the database password, so it is created
# owner-read-only before anything is written to it. Every user-supplied
# value is quoted for Compose (see compose_env_quote); the booleans, the
# port and the duration are validated shapes and stay bare.
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
cat > "$ENV_FILE" <<ENVEOF
ONEUPTIME_URL=$(compose_env_quote "$ONEUPTIME_URL")
ONEUPTIME_TELEMETRY_INGESTION_KEY=$(compose_env_quote "$ONEUPTIME_TELEMETRY_INGESTION_KEY")
DATABASE_SYSTEM=$DATABASE_SYSTEM
DATABASE_ENDPOINT=$(compose_env_quote "$DATABASE_ENDPOINT")
DATABASE_SERVER_ADDRESS=$(compose_env_quote "$DATABASE_SERVER_ADDRESS")
DATABASE_SERVER_PORT=$DATABASE_SERVER_PORT
DATABASE_USERNAME=$(compose_env_quote "$DATABASE_USERNAME")
DATABASE_PASSWORD=$(compose_env_quote "$DATABASE_PASSWORD")
DATABASE_TLS_INSECURE=$DATABASE_TLS_INSECURE
DATABASE_TLS_INSECURE_SKIP_VERIFY=$DATABASE_TLS_INSECURE_SKIP_VERIFY
DATABASE_COLLECTION_INTERVAL=$DATABASE_COLLECTION_INTERVAL
DATABASE_QUERY_EVENTS=$DATABASE_QUERY_EVENTS
DATABASE_SERVER_ID=$(compose_env_quote "$DATABASE_SERVER_ID")
ENVEOF
chmod 600 "$ENV_FILE"

# Start the agent
echo ""
echo "Starting OneUptime Database Agent..."
cd "$INSTALL_DIR"
docker compose up -d

echo ""
echo "=========================================="
echo "  OneUptime Database Agent is running!"
echo "=========================================="
echo ""
echo "The $DATABASE_SYSTEM database $DATABASE_SERVER_ADDRESS:$DATABASE_SERVER_PORT appears under"
echo "Databases in OneUptime after the first collection (about $DATABASE_COLLECTION_INTERVAL)."
echo ""
echo "To check status:  cd $INSTALL_DIR && docker compose ps"
echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
echo "If nothing shows up: curl -fsSL $REPO_BASE/troubleshoot.sh | bash -s -- -d $INSTALL_DIR"
