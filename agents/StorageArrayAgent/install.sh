#!/bin/bash
set -e

echo "=========================================="
echo "  OneUptime Storage Array Agent Installer"
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
# Every user-supplied value goes through this helper. It prefers the literal
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

# An array's management address the way the collector and Pure's exporters
# want it: host name or IP (optionally :port), no scheme and no path —
# https://fa01.example.com/ becomes fa01.example.com.
normalize_endpoint() {
    local value="$1"
    value="${value#"${value%%[![:space:]]*}"}"
    value="${value%"${value##*[![:space:]]}"}"
    value="${value#https://}"
    value="${value#http://}"
    value="${value%%/*}"
    printf '%s' "$value"
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

# Installation directory (decided first so an existing .env can be reused)
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-storage-array-agent}"
ENV_FILE="$INSTALL_DIR/.env"

# Re-running the installer (e.g. to pick up a new collector pin) keeps the
# existing configuration: every value already in .env is reused unless the
# same variable is exported in the shell, and nothing is prompted for again.
# Edit .env directly, export the variable, or delete the file to change one.
if [ -f "$ENV_FILE" ]; then
    echo "Found an existing configuration in $ENV_FILE — reusing it."
    echo "(Exported variables override it; edit or delete the file to change a value.)"
    for name in ONEUPTIME_URL ONEUPTIME_TELEMETRY_INGESTION_KEY STORAGE_ARRAY_NAME \
                STORAGE_SYSTEM STORAGE_ARRAY_COLLECTOR_CONFIG \
                PURE_FA_ENDPOINT PURE_FA_API_TOKEN PURE_FB_ENDPOINT PURE_FB_API_TOKEN \
                STORAGE_ARRAY_INSECURE_SKIP_VERIFY; do
        if [ -z "${!name}" ]; then
            printf -v "$name" '%s' "$(dotenv_get "$name" "$ENV_FILE")"
        fi
    done
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

# ----------------------------------------------------------------------------
# Which array, and how the agent reads it
# ----------------------------------------------------------------------------
# Each choice is one shipped collector config; the platform stamped as
# storage.system and the compose profile that starts Pure's exporter (when
# one is needed) follow from it. STORAGE_SYSTEM=purestorage.flashblade in the
# shell picks the FlashBlade config without asking.
if [ -z "$STORAGE_ARRAY_COLLECTOR_CONFIG" ]; then
    case "$(printf '%s' "$STORAGE_SYSTEM" | tr '[:upper:]' '[:lower:]')" in
        purestorage.flashblade)
            STORAGE_ARRAY_COLLECTOR_CONFIG="otel-collector-config.flashblade.yaml" ;;
    esac
fi

if [ -z "$STORAGE_ARRAY_COLLECTOR_CONFIG" ]; then
    echo "Which array does this agent monitor?"
    echo "  1) Pure Storage FlashArray serving OpenMetrics itself (Purity//FA 6.7 and later)"
    echo "  2) Pure Storage FlashArray on an older Purity//FA (through Pure's exporter)"
    echo "  3) Pure Storage FlashBlade (through Pure's exporter)"
    echo "Not sure about 1 or 2? Run the README's curl test against the array: native"
    echo "metrics answer with purefa_info lines."
    read -rp "Choice [1]: " ARRAY_CHOICE
    case "$ARRAY_CHOICE" in
        2) STORAGE_ARRAY_COLLECTOR_CONFIG="otel-collector-config.flasharray-exporter.yaml" ;;
        3) STORAGE_ARRAY_COLLECTOR_CONFIG="otel-collector-config.flashblade.yaml" ;;
        *) STORAGE_ARRAY_COLLECTOR_CONFIG="otel-collector-config.yaml" ;;
    esac
fi

case "$STORAGE_ARRAY_COLLECTOR_CONFIG" in
    otel-collector-config.yaml)
        STORAGE_SYSTEM="purestorage.flasharray"
        COMPOSE_PROFILES=""
        ;;
    otel-collector-config.flasharray-exporter.yaml)
        STORAGE_SYSTEM="purestorage.flasharray"
        COMPOSE_PROFILES="flasharray-exporter"
        ;;
    otel-collector-config.flashblade.yaml)
        STORAGE_SYSTEM="purestorage.flashblade"
        COMPOSE_PROFILES="flashblade"
        ;;
    *)
        echo "Error: STORAGE_ARRAY_COLLECTOR_CONFIG=\"$STORAGE_ARRAY_COLLECTOR_CONFIG\" is not one of the"
        echo "shipped configs: otel-collector-config.yaml, otel-collector-config.flasharray-exporter.yaml"
        echo "or otel-collector-config.flashblade.yaml."
        exit 1
        ;;
esac

while [ -z "$STORAGE_ARRAY_NAME" ]; do
    read -rp "Array name (shown in OneUptime, keep it stable, e.g. fa-prod-01): " STORAGE_ARRAY_NAME
done
reject_dollar STORAGE_ARRAY_NAME "$STORAGE_ARRAY_NAME"

if [ "$STORAGE_SYSTEM" = "purestorage.flashblade" ]; then
    while [ -z "$PURE_FB_ENDPOINT" ]; do
        read -rp "FlashBlade management address (host name or IP, no https://): " PURE_FB_ENDPOINT
    done
    PURE_FB_ENDPOINT="$(normalize_endpoint "$PURE_FB_ENDPOINT")"
    reject_dollar PURE_FB_ENDPOINT "$PURE_FB_ENDPOINT"
    while [ -z "$PURE_FB_API_TOKEN" ]; do
        # -s: never echo the token to the terminal.
        read -rsp "API token of the FlashBlade's read-only user: " PURE_FB_API_TOKEN
        echo ""
    done
    reject_dollar PURE_FB_API_TOKEN "$PURE_FB_API_TOKEN"
else
    while [ -z "$PURE_FA_ENDPOINT" ]; do
        read -rp "FlashArray management address (host name or IP, no https://): " PURE_FA_ENDPOINT
    done
    PURE_FA_ENDPOINT="$(normalize_endpoint "$PURE_FA_ENDPOINT")"
    reject_dollar PURE_FA_ENDPOINT "$PURE_FA_ENDPOINT"
    while [ -z "$PURE_FA_API_TOKEN" ]; do
        # -s: never echo the token to the terminal.
        read -rsp "API token of the FlashArray's read-only user: " PURE_FA_API_TOKEN
        echo ""
    done
    reject_dollar PURE_FA_API_TOKEN "$PURE_FA_API_TOKEN"
fi

# Only the native config talks TLS to the array itself (Pure's exporters do
# not verify the array's certificate), so only it asks.
if [ -z "$STORAGE_ARRAY_INSECURE_SKIP_VERIFY" ] && [ "$STORAGE_ARRAY_COLLECTOR_CONFIG" = "otel-collector-config.yaml" ]; then
    echo "FlashArrays ship a self-signed certificate, which the collector cannot verify."
    read -rp "Verify the array's certificate anyway (it is signed by a CA you trust)? [y/N]: " VERIFY_TLS
    if [[ "$VERIFY_TLS" =~ ^[Yy] ]]; then
        STORAGE_ARRAY_INSECURE_SKIP_VERIFY="false"
    fi
fi
# Verification stays off unless the value is exactly "false".
if [ "$(printf '%s' "$STORAGE_ARRAY_INSECURE_SKIP_VERIFY" | tr '[:upper:]' '[:lower:]')" = "false" ]; then
    STORAGE_ARRAY_INSECURE_SKIP_VERIFY="false"
else
    STORAGE_ARRAY_INSECURE_SKIP_VERIFY="true"
fi

# Create installation directory
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download the compose file and all three collector configs, so switching
# the array type later is an .env edit. A file you edited (an added label,
# a changed interval) is kept as <file>.bak.<timestamp> before it is
# replaced.
REPO_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/StorageArrayAgent"
AGENT_FILES="docker-compose.yml otel-collector-config.yaml otel-collector-config.flasharray-exporter.yaml otel-collector-config.flashblade.yaml"
BACKUPS=""

echo "Downloading configuration files..."
for file in $AGENT_FILES; do
    download="$INSTALL_DIR/.$file.download"
    curl -fsSL "$REPO_BASE/$file" -o "$download"
    if [ -f "$INSTALL_DIR/$file" ] && ! cmp -s "$download" "$INSTALL_DIR/$file"; then
        backup="$INSTALL_DIR/$file.bak.$(date +%Y%m%d%H%M%S)"
        cp "$INSTALL_DIR/$file" "$backup"
        BACKUPS="$BACKUPS $backup"
    fi
    mv "$download" "$INSTALL_DIR/$file"
done

# Create .env file. It holds the array's API token, so it is created
# owner-read-only before anything is written to it. Every user-supplied
# value is quoted for Compose (see compose_env_quote); the platform, the
# config, the profile and the boolean are validated shapes and stay bare.
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
cat > "$ENV_FILE" <<ENVEOF
ONEUPTIME_URL=$(compose_env_quote "$ONEUPTIME_URL")
ONEUPTIME_TELEMETRY_INGESTION_KEY=$(compose_env_quote "$ONEUPTIME_TELEMETRY_INGESTION_KEY")
STORAGE_ARRAY_NAME=$(compose_env_quote "$STORAGE_ARRAY_NAME")
STORAGE_SYSTEM=$STORAGE_SYSTEM
STORAGE_ARRAY_COLLECTOR_CONFIG=$STORAGE_ARRAY_COLLECTOR_CONFIG
COMPOSE_PROFILES=$COMPOSE_PROFILES
PURE_FA_ENDPOINT=$(compose_env_quote "$PURE_FA_ENDPOINT")
PURE_FA_API_TOKEN=$(compose_env_quote "$PURE_FA_API_TOKEN")
PURE_FB_ENDPOINT=$(compose_env_quote "$PURE_FB_ENDPOINT")
PURE_FB_API_TOKEN=$(compose_env_quote "$PURE_FB_API_TOKEN")
STORAGE_ARRAY_INSECURE_SKIP_VERIFY=$STORAGE_ARRAY_INSECURE_SKIP_VERIFY
ENVEOF
chmod 600 "$ENV_FILE"

# Start the agent. Stop whatever this directory ran before first — with
# every profile, so an exporter the new choice no longer needs goes away —
# then start what .env selects. Compose does not notice that a bind-mounted
# config changed, so this also makes a re-run apply the files it just
# downloaded.
echo ""
echo "Starting OneUptime Storage Array Agent..."
cd "$INSTALL_DIR"
docker compose --profile flasharray-exporter --profile flashblade down --remove-orphans > /dev/null 2>&1 || true
if ! docker compose up -d; then
    echo ""
    echo "Error: the agent did not start. If Docker reports that the container name"
    echo "\"oneuptime-storage-array-agent\" is already in use, another array's agent runs on"
    echo "this machine: give this one its own container_name in $INSTALL_DIR/docker-compose.yml"
    echo "(see README.md, \"Monitoring several arrays\") and run: cd $INSTALL_DIR && docker compose up -d"
    exit 1
fi

echo ""
echo "=========================================="
echo "  OneUptime Storage Array Agent is running!"
echo "=========================================="
echo ""
echo "The array '$STORAGE_ARRAY_NAME' appears under Storage Arrays in OneUptime after"
echo "the first scrape (about a minute)."
if [ "$STORAGE_SYSTEM" = "purestorage.flashblade" ]; then
    echo "Reading the FlashBlade at $PURE_FB_ENDPOINT through Pure's exporter (pure-fb-exporter)."
elif [ -n "$COMPOSE_PROFILES" ]; then
    echo "Reading the FlashArray at $PURE_FA_ENDPOINT through Pure's exporter (pure-fa-exporter)."
else
    echo "Reading the FlashArray at $PURE_FA_ENDPOINT directly (native OpenMetrics)."
fi
if [ -n "$BACKUPS" ]; then
    echo ""
    echo "Files you had edited were kept before being replaced:"
    for backup in $BACKUPS; do
        echo "  $backup"
    done
    echo "Re-apply your changes to the new files, then: cd $INSTALL_DIR && docker compose up -d --force-recreate"
fi
echo ""
echo "To check status:  cd $INSTALL_DIR && docker compose ps"
echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
echo "If nothing shows up: curl -fsSL $REPO_BASE/troubleshoot.sh | bash -s -- -d $INSTALL_DIR"
