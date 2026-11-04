#!/bin/bash
set -e

echo "=========================================="
echo "  OneUptime OpenStack Logs Installer"
echo "=========================================="
echo ""

# The OpenStack agent's optional logs profile, on one controller or compute node. The
# agent that watches the cloud (install.sh) runs once, off the cloud. This one runs on
# every machine whose services' logs you want, and it only reads them.
#
#   bash install-logs.sh files      Kolla-Ansible: its log files, with Docker Compose
#   bash install-logs.sh journald   OpenStack-Ansible: the journal, as a systemd service
#
# With neither, it looks at the machine, and asks if it cannot tell. Every answer also
# works as an environment variable, so a run across a fleet can ask nothing at all.
# Running it again is the upgrade, and keeps every answer.

ENV_NAMES="ONEUPTIME_URL ONEUPTIME_TELEMETRY_INGESTION_KEY OPENSTACK_CLOUD_NAME \
OPENSTACK_NODE_NAME OPENSTACK_LOGS_DIRECTORY OPENSTACK_LOGS_TIMEZONE OPENSTACK_LOGS_UNITS"

# An answer given as an environment variable stays this script's, and is handed to no
# program it runs. Compose gives variables in its environment precedence over .env, so
# every start runs what every later one will: .env alone.
for name in $ENV_NAMES; do
    export -n "$name"
done

PROFILE="$(printf '%s' "${OPENSTACK_LOGS_PROFILE:-}" | tr '[:upper:]' '[:lower:]')"
for argument in "$@"; do
    case "$argument" in
        files | journald) PROFILE="$argument" ;;
        *)
            echo "Error: unknown argument $argument. Usage: bash install-logs.sh [files|journald]"
            exit 2
            ;;
    esac
done

INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-openstack-logs}"
DEFAULT_INSTALL_DIR="/opt/oneuptime-openstack-logs"
ENV_FILE="$INSTALL_DIR/.env"
UNIT_DIR="${SYSTEMD_UNIT_DIR:-/etc/systemd/system}"
SERVICE_NAME="oneuptime-openstack-logs"
KOLLA_LOGS_DIRECTORY="/var/lib/docker/volumes/kolla_logs/_data"

# The release the journal's service runs: the version docker-compose.logs.yml pins, each
# archive held to a sha256 kept here rather than one fetched from the same release.
# Tests/Ops/OpenStackAgentLogs.test.js holds these to install.sh, so bump them together.
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
# The profile a re-run was installed with, whatever the machine looks like by now.
if [ -z "$PROFILE" ] && [ -x "$INSTALL_DIR/otelcol-contrib" ]; then
    PROFILE="journald"
elif [ -z "$PROFILE" ] && [ -f "$INSTALL_DIR/docker-compose.logs.yml" ]; then
    PROFILE="files"
fi

if [ -z "$PROFILE" ]; then
    if [ -d "$KOLLA_LOGS_DIRECTORY" ]; then
        PROFILE="files"
        echo "Found Kolla-Ansible's logs in $KOLLA_LOGS_DIRECTORY: reading those files."
    elif command -v journalctl >/dev/null 2>&1 \
        && [ -n "$(journalctl --no-pager -n 1 -q -u 'nova-*' -u 'neutron-*' -u 'keystone*' -u 'devstack@*' 2>/dev/null)" ]; then
        PROFILE="journald"
        echo "Found OpenStack's services in this machine's journal: reading those."
    else
        echo "How does this machine's OpenStack log? Kolla-Ansible writes files; OpenStack-Ansible"
        echo "writes to the journal. On OpenStack-Helm, Atmosphere or Red Hat's distribution, install"
        echo "the Kubernetes agent instead: the OpenStack guide says how."
        while [ "$PROFILE" != "files" ] && [ "$PROFILE" != "journald" ]; do
            read -rp "files or journald: " PROFILE
        done
    fi
fi

if [ "$PROFILE" = "journald" ]; then
    if [ "$(uname -s)" != "Linux" ]; then
        echo "Error: reading the journal runs a systemd service, so it needs Linux."
        exit 1
    fi
    if [ "$(id -u)" != "0" ]; then
        echo "Error: reading the journal adds a systemd service, so it needs root."
        echo "Try: sudo bash install-logs.sh journald"
        exit 1
    fi
    for tool in systemctl journalctl tar; do
        if ! command -v "$tool" >/dev/null 2>&1; then
            echo "Error: reading the journal needs $tool, and this machine has none."
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
        echo "Error: reading Kolla-Ansible's files runs a container, and Docker is not installed."
        exit 1
    fi
    if ! docker compose version >/dev/null 2>&1; then
        echo "Error: Docker Compose v2 is not available. Please install the docker compose plugin."
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

# Asked of nobody: it is this machine, and what a hypervisor's page reads logs by.
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
# Files: Docker Compose
# ----------------------------------------------------------------------------
if [ "$PROFILE" = "files" ]; then
    download_agent_file "docker-compose.logs.yml" "$INSTALL_DIR/docker-compose.logs.yml"
    download_agent_file "otel-collector-logs-files.yaml" "$INSTALL_DIR/otel-collector-logs-files.yaml"

    touch "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    cat > "$ENV_FILE" <<ENVEOF
ONEUPTIME_URL=$(compose_env_quote "$ONEUPTIME_URL")
ONEUPTIME_TELEMETRY_INGESTION_KEY=$(compose_env_quote "$ONEUPTIME_TELEMETRY_INGESTION_KEY")
OPENSTACK_CLOUD_NAME=$(compose_env_quote "$OPENSTACK_CLOUD_NAME")
OPENSTACK_NODE_NAME=$(compose_env_quote "$OPENSTACK_NODE_NAME")
OPENSTACK_LOGS_DIRECTORY=$(compose_env_quote "${OPENSTACK_LOGS_DIRECTORY:-$KOLLA_LOGS_DIRECTORY}")
OPENSTACK_LOGS_TIMEZONE=$(compose_env_quote "${OPENSTACK_LOGS_TIMEZONE:-UTC}")
ENVEOF
    chmod 600 "$ENV_FILE"

    cd "$INSTALL_DIR"
    if ! docker compose -f docker-compose.logs.yml pull; then
        echo "Warning: could not pull the image; starting with the one this machine has."
    fi
    # --force-recreate: the collector reads its config only when it starts, and Compose
    # recreates a container for a changed definition, never for a changed bind mount.
    docker compose -f docker-compose.logs.yml up -d --force-recreate

    echo ""
    echo "=========================================="
    echo "  OneUptime OpenStack Logs is running"
    echo "=========================================="
    echo ""
    echo "This machine's OpenStack logs appear on the Logs page of cloud \"$OPENSTACK_CLOUD_NAME\"."
    echo ""
    echo "To check status:  cd $INSTALL_DIR && docker compose -f docker-compose.logs.yml ps"
    echo "To view its log:  docker logs -f $SERVICE_NAME"
    echo "To stop:          cd $INSTALL_DIR && docker compose -f docker-compose.logs.yml down"
fi

# ----------------------------------------------------------------------------
# The journal: a systemd service
# ----------------------------------------------------------------------------
if [ "$PROFILE" = "journald" ]; then
    # The services' users walk through this folder to the files they read.
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

    download_agent_file "otel-collector-logs-journald.yaml" "$INSTALL_DIR/otel-collector-logs-journald.yaml"
    UNIT_FILE="$UNIT_DIR/$SERVICE_NAME.service"
    download_agent_file "systemd/oneuptime-openstack-logs-native.service" "$UNIT_FILE"
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
        printf 'OPENSTACK_NODE_NAME=%s\n' "$(systemd_env_quote "$OPENSTACK_NODE_NAME")"
        # Only when someone set it: the unit holds the default, which an upgrade can change.
        if [ -n "$OPENSTACK_LOGS_UNITS" ]; then
            printf 'OPENSTACK_LOGS_UNITS=%s\n' "$(systemd_env_quote "$OPENSTACK_LOGS_UNITS")"
        fi
    } > "$ENV_FILE"
    chmod 600 "$ENV_FILE"

    mv -f "$RELEASE_WORK_DIR/otelcol-contrib" "$INSTALL_DIR/otelcol-contrib"

    systemctl daemon-reload
    systemctl enable "$SERVICE_NAME"
    systemctl restart "$SERVICE_NAME"

    echo ""
    echo "=========================================="
    echo "  OneUptime OpenStack Logs is running"
    echo "=========================================="
    echo ""
    echo "This machine's OpenStack logs appear on the Logs page of cloud \"$OPENSTACK_CLOUD_NAME\"."
    echo ""
    echo "To check status:  systemctl status $SERVICE_NAME --no-pager"
    echo "To view its log:  journalctl -u $SERVICE_NAME -f"
    echo "To stop:          systemctl stop $SERVICE_NAME"
fi

echo "To upgrade:       run this installer again; it reuses $ENV_FILE"

if [ "${#EDITED_FILES[@]}" -gt 0 ]; then
    echo ""
    echo "NOTE: these files differ from the new versions and were replaced. They may hold edits"
    echo "of yours; the old copies are kept next to them:"
    for backup in "${EDITED_FILES[@]}"; do
        echo "  $backup"
    done
fi
