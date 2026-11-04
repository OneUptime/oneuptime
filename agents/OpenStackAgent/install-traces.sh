#!/bin/bash
set -e

echo "=========================================="
echo "  OneUptime OpenStack Traces Installer"
echo "=========================================="
echo ""

# The OpenStack agent's optional traces profile, on one controller or compute node. The
# agent that watches the cloud (install.sh) runs once, off the cloud. This one runs on
# every machine whose services you want traced, takes the spans OSProfiler's OTLP driver
# posts to it over plain HTTP, and forwards them over TLS.
#
#   bash install-traces.sh docker   With Docker Compose
#   bash install-traces.sh native   As a systemd service, without Docker
#
# With neither, it uses Docker where the machine has it. Every answer also works as an
# environment variable, so a run across a fleet can ask nothing at all. Running it again is
# the upgrade, and keeps every answer. It never touches OpenStack's own config, and nothing
# arrives until your services are told to send spans here and a request is signed: it says
# what to set when it ends.

ENV_NAMES="ONEUPTIME_URL ONEUPTIME_TELEMETRY_INGESTION_KEY OPENSTACK_CLOUD_NAME \
OPENSTACK_REGION_NAME OPENSTACK_NODE_NAME OPENSTACK_TRACES_LISTEN_ADDRESS \
OPENSTACK_TRACES_PUBLISH_ADDRESS"

# An answer given as an environment variable stays this script's, and is handed to no
# program it runs. Compose gives variables in its environment precedence over .env, so
# every start runs what every later one will: .env alone.
for name in $ENV_NAMES; do
    export -n "$name"
done

PROFILE="$(printf '%s' "${OPENSTACK_TRACES_PROFILE:-}" | tr '[:upper:]' '[:lower:]')"
for argument in "$@"; do
    case "$argument" in
        docker | native) PROFILE="$argument" ;;
        *)
            echo "Error: unknown argument $argument. Usage: bash install-traces.sh [docker|native]"
            exit 2
            ;;
    esac
done

INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-openstack-traces}"
DEFAULT_INSTALL_DIR="/opt/oneuptime-openstack-traces"
ENV_FILE="$INSTALL_DIR/.env"
UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
SERVICE_NAME="oneuptime-openstack-traces"

# The release the native service runs: the version docker-compose.traces.yml pins, each
# archive held to a sha256 kept here rather than one fetched from the same release.
# Tests/Ops/OpenStackAgentTraces.test.js holds these to install.sh, so bump them together.
COLLECTOR_VERSION="0.161.0"
COLLECTOR_SHA256_AMD64="778c689efa681ff6e4722ce9f66b9b7f57c3ba009ab2e2b43dc2e0315862c731"
COLLECTOR_SHA256_ARM64="cd5de93213a0dbb90e4998b3b9e4e15ed691ec635cf7cf4147f95799fb16b676"

# ----------------------------------------------------------------------------
# .env quoting: see install.sh, whose helpers these are
# ----------------------------------------------------------------------------
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

systemd_env_quote() {
    local value="$1"
    value="${value//\\/\\\\}"
    value="${value//\"/\\\"}"
    printf '"%s"' "$value"
}

# One variable back from an existing .env, written by either of the above or by hand.
env_get() {
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
            rest="${value#\"}"
            value=""
            while [ -n "$rest" ]; do
                ch="${rest:0:1}"
                if [ "$ch" = '\' ] && [ -n "${rest:1:1}" ]; then
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
            value="${value#"${value%%[![:space:]]*}"}"
            value="${value%"${value##*[![:space:]]}"}"
            ;;
    esac
    printf '%s' "$value"
}

file_sha256() {
    if command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | cut -d ' ' -f 1
    elif command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | cut -d ' ' -f 1
    fi
}

# ----------------------------------------------------------------------------
# Which profile, and what it needs
# ----------------------------------------------------------------------------
# The way a re-run was installed, whatever the machine looks like by now.
if [ -z "$PROFILE" ] && [ -x "$INSTALL_DIR/otelcol-contrib" ]; then
    PROFILE="native"
elif [ -z "$PROFILE" ] && [ -f "$INSTALL_DIR/docker-compose.traces.yml" ]; then
    PROFILE="docker"
fi

if [ -z "$PROFILE" ]; then
    if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
        PROFILE="docker"
        echo "Found Docker Compose: running this as a container."
    else
        PROFILE="native"
        echo "No Docker Compose here: running this as a systemd service."
    fi
fi

if [ "$PROFILE" = "native" ]; then
    if [ "$(uname -s)" != "Linux" ]; then
        echo "Error: without Docker this runs a systemd service, so it needs Linux."
        exit 1
    fi
    if [ "$(id -u)" != "0" ]; then
        echo "Error: without Docker this adds a systemd service, so it needs root."
        echo "Try: sudo bash install-traces.sh native"
        exit 1
    fi
    for tool in systemctl tar; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            echo "Error: without Docker this needs $tool, and this machine has none."
            exit 1
        fi
    done
    if [ -z "$(command -v sha256sum)$(command -v shasum)" ]; then
        echo "Error: this checks what it downloads, and this machine has no sha256sum."
        exit 1
    fi
    case "$(uname -m)" in
        x86_64 | amd64)
            RELEASE_ARCH="amd64"
            COLLECTOR_SHA256="$COLLECTOR_SHA256_AMD64"
            ;;
        aarch64 | arm64)
            RELEASE_ARCH="arm64"
            COLLECTOR_SHA256="$COLLECTOR_SHA256_ARM64"
            ;;
        *)
            echo "Error: this has a collector release pinned for x86_64 and arm64, not $(uname -m)."
            exit 1
            ;;
    esac
else
    if ! command -v docker >/dev/null 2>&1; then
        echo "Error: this runs a container, and Docker is not installed. Try: sudo bash install-traces.sh native"
        exit 1
    fi
    if ! docker compose version >/dev/null 2>&1; then
        echo "Error: Docker Compose v2 is not available. Please install the docker compose plugin, or try: sudo bash install-traces.sh native"
        exit 1
    fi
fi

# ----------------------------------------------------------------------------
# The answers
# ----------------------------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
    if [ ! -r "$ENV_FILE" ]; then
        echo "Error: $ENV_FILE exists, but this user cannot read it. Run this as the user that installed it."
        exit 1
    fi
    echo "Found an existing configuration in $ENV_FILE: reusing it."
    for name in $ENV_NAMES; do
        if [ -z "${!name}" ]; then
            printf -v "$name" '%s' "$(env_get "$name" "$ENV_FILE")"
        fi
    done
fi

while [ -z "$ONEUPTIME_URL" ]; do
    read -rp "OneUptime URL (e.g., https://oneuptime.com): " ONEUPTIME_URL
done
ONEUPTIME_URL="${ONEUPTIME_URL%/}"

while [ -z "$ONEUPTIME_TELEMETRY_INGESTION_KEY" ]; do
    # -s: never echo it to the terminal.
    read -rsp "OneUptime Telemetry Ingestion Key: " ONEUPTIME_TELEMETRY_INGESTION_KEY
    echo ""
done

if [ -z "$OPENSTACK_CLOUD_NAME" ]; then
    read -rp "This cloud's name in OneUptime, the one its agent reports under [openstack]: " OPENSTACK_CLOUD_NAME
    OPENSTACK_CLOUD_NAME="${OPENSTACK_CLOUD_NAME:-openstack}"
fi

if [ -z "$OPENSTACK_REGION_NAME" ]; then
    read -rp "The region this machine serves [RegionOne]: " OPENSTACK_REGION_NAME
    OPENSTACK_REGION_NAME="${OPENSTACK_REGION_NAME:-RegionOne}"
fi

# Asked of nobody: it is this machine, and what joins a span to the service on it.
if [ -z "$OPENSTACK_NODE_NAME" ]; then
    OPENSTACK_NODE_NAME="$(hostname)"
fi

# ----------------------------------------------------------------------------
# Where the files come from: every agent's install.sh has this same block
# ----------------------------------------------------------------------------
AGENT_FILES_PATH="install/openstack-agent"
AGENT_FILES_ON_GITHUB="https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/OpenStackAgent"
AGENT_FILES_URL=""
AGENT_FILE_ANSWER=""

download_agent_text() {
    AGENT_FILE_ANSWER="$(curl -sSL -o "$2" -w '%{http_code} %{content_type}' "$1")" || AGENT_FILE_ANSWER="000"
    case "$AGENT_FILE_ANSWER" in
        "200 text/plain"*) return 0 ;;
        *) return 1 ;;
    esac
}

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

# A file you edited is kept next to the new one, and named at the end.
EDITED_FILES=()
download_agent_file() {
    local file="$1" dest="$2" tmp backup
    tmp="$(mktemp "$dest.download.XXXXXX")"
    fetch_agent_file "$file" "$tmp"
    chmod 0644 "$tmp"
    if [ -f "$dest" ] && ! cmp -s "$tmp" "$dest"; then
        backup="$dest.bak.$(date +%Y%m%d%H%M%S)"
        cp -p "$dest" "$backup"
        EDITED_FILES+=("$backup")
    fi
    mv -f "$tmp" "$dest"
}

echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# ----------------------------------------------------------------------------
# Docker Compose
# ----------------------------------------------------------------------------
if [ "$PROFILE" = "docker" ]; then
    download_agent_file "docker-compose.traces.yml" "$INSTALL_DIR/docker-compose.traces.yml"
    download_agent_file "otel-collector-traces.yaml" "$INSTALL_DIR/otel-collector-traces.yaml"

    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    {
        printf 'ONEUPTIME_URL=%s\n' "$(compose_env_quote "$ONEUPTIME_URL")"
        printf 'ONEUPTIME_TELEMETRY_INGESTION_KEY=%s\n' "$(compose_env_quote "$ONEUPTIME_TELEMETRY_INGESTION_KEY")"
        printf 'OPENSTACK_CLOUD_NAME=%s\n' "$(compose_env_quote "$OPENSTACK_CLOUD_NAME")"
        printf 'OPENSTACK_REGION_NAME=%s\n' "$(compose_env_quote "$OPENSTACK_REGION_NAME")"
        printf 'OPENSTACK_NODE_NAME=%s\n' "$(compose_env_quote "$OPENSTACK_NODE_NAME")"
        # Only when someone set it: the compose file holds the default, this machine's loopback.
        if [ -n "$OPENSTACK_TRACES_PUBLISH_ADDRESS" ]; then
            printf 'OPENSTACK_TRACES_PUBLISH_ADDRESS=%s\n' "$(compose_env_quote "$OPENSTACK_TRACES_PUBLISH_ADDRESS")"
        fi
    } > "$ENV_FILE"
    chmod 600 "$ENV_FILE"

    cd "$INSTALL_DIR"
    if ! docker compose -f docker-compose.traces.yml pull; then
        echo "Warning: could not pull the image; starting with the one this machine has."
    fi
    # --force-recreate: the collector reads its config only when it starts, and Compose
    # recreates a container for a changed definition, never for a changed bind mount.
    docker compose -f docker-compose.traces.yml up -d --force-recreate

    LISTENS_ON="${OPENSTACK_TRACES_PUBLISH_ADDRESS:-127.0.0.1}:4318"
    STATUS_COMMAND="cd $INSTALL_DIR && docker compose -f docker-compose.traces.yml ps"
    LOG_COMMAND="docker logs -f $SERVICE_NAME"
    STOP_COMMAND="cd $INSTALL_DIR && docker compose -f docker-compose.traces.yml down"
fi

# ----------------------------------------------------------------------------
# A systemd service
# ----------------------------------------------------------------------------
if [ "$PROFILE" = "native" ]; then
    # The service's user walks through this folder to the files it reads.
    chmod 0755 "$INSTALL_DIR"
    RELEASE_WORK_DIR="$(mktemp -d "$INSTALL_DIR/.release.XXXXXX")"
    trap 'rm -rf "$RELEASE_WORK_DIR"' EXIT
    RELEASE_URL="https://github.com/open-telemetry/opentelemetry-collector-releases/releases/download/v${COLLECTOR_VERSION}/otelcol-contrib_${COLLECTOR_VERSION}_linux_${RELEASE_ARCH}.tar.gz"
    echo "Downloading ${RELEASE_URL##*/}..."
    if ! curl -fsSL --retry 3 -o "$RELEASE_WORK_DIR/collector.tar.gz" "$RELEASE_URL"; then
        echo "Error: could not download $RELEASE_URL"
        exit 1
    fi
    RELEASE_ACTUAL="$(file_sha256 "$RELEASE_WORK_DIR/collector.tar.gz")"
    if [ "$RELEASE_ACTUAL" != "$COLLECTOR_SHA256" ]; then
        echo "Error: ${RELEASE_URL##*/} does not match the sha256 this installer pins, so it was not installed."
        echo "  expected: $COLLECTOR_SHA256"
        echo "  got:      $RELEASE_ACTUAL"
        exit 1
    fi
    tar --no-same-owner -xzf "$RELEASE_WORK_DIR/collector.tar.gz" -C "$RELEASE_WORK_DIR" otelcol-contrib
    chmod 0755 "$RELEASE_WORK_DIR/otelcol-contrib"

    download_agent_file "otel-collector-traces.yaml" "$INSTALL_DIR/otel-collector-traces.yaml"
    UNIT_FILE="$UNIT_DIR/$SERVICE_NAME.service"
    download_agent_file "systemd/oneuptime-openstack-traces-native.service" "$UNIT_FILE"
    # The unit names the default folder, so another one goes into the installed copy.
    if [ "$INSTALL_DIR" != "$DEFAULT_INSTALL_DIR" ]; then
        RENDERED_UNIT="$(mktemp "$UNIT_FILE.render.XXXXXX")"
        sed "s|$DEFAULT_INSTALL_DIR|$INSTALL_DIR|g" "$UNIT_FILE" > "$RENDERED_UNIT"
        chmod 0644 "$RENDERED_UNIT"
        mv -f "$RENDERED_UNIT" "$UNIT_FILE"
    fi

    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    {
        printf 'ONEUPTIME_URL=%s\n' "$(systemd_env_quote "$ONEUPTIME_URL")"
        printf 'ONEUPTIME_TELEMETRY_INGESTION_KEY=%s\n' "$(systemd_env_quote "$ONEUPTIME_TELEMETRY_INGESTION_KEY")"
        printf 'OPENSTACK_CLOUD_NAME=%s\n' "$(systemd_env_quote "$OPENSTACK_CLOUD_NAME")"
        printf 'OPENSTACK_REGION_NAME=%s\n' "$(systemd_env_quote "$OPENSTACK_REGION_NAME")"
        printf 'OPENSTACK_NODE_NAME=%s\n' "$(systemd_env_quote "$OPENSTACK_NODE_NAME")"
        # Only when someone set it: the unit holds the default, this machine's loopback.
        if [ -n "$OPENSTACK_TRACES_LISTEN_ADDRESS" ]; then
            printf 'OPENSTACK_TRACES_LISTEN_ADDRESS=%s\n' "$(systemd_env_quote "$OPENSTACK_TRACES_LISTEN_ADDRESS")"
        fi
    } > "$ENV_FILE"
    chmod 600 "$ENV_FILE"

    mv -f "$RELEASE_WORK_DIR/otelcol-contrib" "$INSTALL_DIR/otelcol-contrib"

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    systemctl restart "$SERVICE_NAME"

    LISTENS_ON="${OPENSTACK_TRACES_LISTEN_ADDRESS:-127.0.0.1:4318}"
    STATUS_COMMAND="systemctl status $SERVICE_NAME --no-pager"
    LOG_COMMAND="journalctl -u $SERVICE_NAME -f"
    STOP_COMMAND="systemctl stop $SERVICE_NAME"
fi

echo ""
echo "=========================================="
echo "  OneUptime OpenStack Traces is running"
echo "=========================================="
echo ""
echo "It listens on $LISTENS_ON and forwards to $ONEUPTIME_URL, under cloud \"$OPENSTACK_CLOUD_NAME\"."
echo "Nothing arrives yet. Each service on this machine needs OSProfiler's OTLP libraries"
echo "(pip install opentelemetry-sdk opentelemetry-exporter-otlp), and this in its config,"
echo "with a key of your own, the same on every service:"
echo ""
echo "  [profiler]"
echo "  enabled = True"
echo "  hmac_keys = <your key>"
echo "  connection_string = otlp://$LISTENS_ON"
echo "  trace_sqlalchemy = False"
echo ""
echo "Then open this cloud's Traces page in OneUptime: it gives the command that signs a request."
echo ""
echo "To check status:  $STATUS_COMMAND"
echo "To view its log:  $LOG_COMMAND"
echo "To stop:          $STOP_COMMAND"
echo "To upgrade:       run this installer again; it reuses $ENV_FILE"

if [ "${#EDITED_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "NOTE: these files differ from the new versions and were replaced. They may hold edits"
    echo "of yours; the old copies are kept next to them:"
    for backup in "${EDITED_FILES[@]}"; do
        echo "  $backup"
    done
fi
