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
OPENSTACK_TRACES_PUBLISH_ADDRESS OPENSTACK_TRACES_CONTAINER_NAME"

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
COLLECTOR_VERSION="0.165.0"
COLLECTOR_SHA256_AMD64="bd6e73d94bf3359ad6fac25529a8ee308adb9b0b8a0e8af034ed3891fbe5aa33"
COLLECTOR_SHA256_ARM64="376420729c862230807bc89811d07d10031eaeca3f6481fe371a2bdcefd2c8fa"

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
# The collector's container name, with Docker
# ----------------------------------------------------------------------------
# One of these runs on a machine, under its default name. Another one on the same machine,
# in a directory of its own, needs a name of its own: docker-compose.traces.yml reads it from
# .env (container_name: ${OPENSTACK_TRACES_CONTAINER_NAME:-oneuptime-openstack-traces}). It is
# OPENSTACK_TRACES_CONTAINER_NAME exported, or in .env on a re-run, like every other answer; else,
# for an install set up before .env held it, the name its compose file was given by hand or
# its container runs as; else the directory's, oneuptime-openstack-traces-<project> (the default
# directory's is the default name). Compose names a project after its directory: two
# directories of one name are one project, and an install whose project another directory
# runs stops before it changes anything. The helpers are install.sh's.
COMPOSE_FILE_NAME="docker-compose.traces.yml"
AGENT_SERVICE="oneuptime-openstack-traces"
DEFAULT_CONTAINER_NAME="oneuptime-openstack-traces"

# compose_project_name reads .env as Compose does, which env_get does too.
dotenv_get() {
    env_get "$@"
}

# Whether $1 is a name Docker gives a container: a letter or a digit, then at
# least one more letter, digit, _, . or -.
is_container_name() {
    case "$1" in
        "" | ? | [!a-zA-Z0-9]* | *[!a-zA-Z0-9_.-]*) return 1 ;;
    esac
    return 0
}

# compose_container_name <compose file>: the container_name the agent's
# service sets there, when it is a name written out (not ${...}), or nothing.
compose_container_name() {
    local value=""
    [ -f "$1" ] || return 0
    value="$(awk -v service="$AGENT_SERVICE" '
        /^[[:space:]]*(#.*)?$/ { next }
        {
            match($0, /^[[:space:]]*/)
            indent = RLENGTH
            if (inside && indent <= service_indent) { inside = 0 }
            if (!inside && $0 ~ ("^[[:space:]]+" service ":[[:space:]]*(#.*)?$")) {
                inside = 1
                service_indent = indent
                next
            }
            if (inside && $0 ~ /^[[:space:]]+container_name:/) {
                sub(/^[[:space:]]+container_name:[[:space:]]*/, "")
                sub(/[[:space:]]+#.*$/, "")
                sub(/[[:space:]]+$/, "")
                print
                exit
            }
        }' "$1" 2>/dev/null)" || true
    case "$value" in
        \"*\") value="${value#\"}"; value="${value%\"}" ;;
        \'*\') value="${value#\'}"; value="${value%\'}" ;;
    esac
    if is_container_name "$value"; then
        printf '%s' "$value"
    fi
}

# The installation directory's container name for this agent: after the
# Compose project the directory runs (a-z 0-9 _ - only, so a container name
# too, once it starts with this agent's name).
directory_container_name() {
    local project=""
    project="$(compose_project_name)"
    case "$project" in
        "") printf '%s' "$DEFAULT_CONTAINER_NAME" ;;
        "$DEFAULT_CONTAINER_NAME"*) printf '%s' "$project" ;;
        *) printf '%s-%s' "$DEFAULT_CONTAINER_NAME" "$project" ;;
    esac
}

# The installation directory as Compose records it (an absolute path, with
# no trailing /).
absolute_install_dir() {
    local dir="$INSTALL_DIR"
    case "$dir" in
        /*) ;;
        *) dir="$(pwd)/$dir" ;;
    esac
    while [ "${dir%/}" != "$dir" ] && [ -n "${dir%/}" ]; do
        dir="${dir%/}"
    done
    printf '%s' "$dir"
}

# The name of the Compose project the installation directory runs as.
compose_project_name() {
    local name="${COMPOSE_PROJECT_NAME:-}" dir=""
    if [ -z "$name" ] && [ -f "$ENV_FILE" ]; then
        name="$(dotenv_get COMPOSE_PROJECT_NAME "$ENV_FILE")"
    fi
    if [ -z "$name" ]; then
        dir="$(absolute_install_dir)"
        name="${dir##*/}"
    fi
    printf '%s' "$name" | tr '[:upper:]' '[:lower:]' | tr -cd 'a-z0-9_-' | sed 's/^[-_]*//'
}

# Whether $1 and $2 are one directory on this machine, however each is
# spelled (a symlink, a trailing /).
same_directory() {
    local first="" second=""
    first="$(cd "$1" 2>/dev/null && pwd -P)" || return 1
    second="$(cd "$2" 2>/dev/null && pwd -P)" || return 1
    [ "$first" = "$second" ]
}

# Another directory, still on this machine, whose containers run in the
# Compose project this one would run in, or nothing. A directory that is
# gone (the agent was moved) holds no agent but those containers, which are
# this one's to replace.
other_project_directory() {
    local project="" here="" dir=""
    project="$(compose_project_name)"
    [ -n "$project" ] || return 0
    here="$(absolute_install_dir)"
    while IFS= read -r dir; do
        dir="${dir%/}"
        [ -n "$dir" ] && [ "$dir" != "$here" ] && [ -d "$dir" ] || continue
        same_directory "$dir" "$here" && continue
        printf '%s' "$dir"
        return 0
    done <<PROJECT_DIRECTORIES_EOF
$(docker ps -a --filter "label=com.docker.compose.project=$project" \
    --format '{{.Label "com.docker.compose.project.working_dir"}}' 2>/dev/null | sort -u)
PROJECT_DIRECTORIES_EOF
}

# choose_collector_container_name: the name of an install that was set up before .env held
# it: the one its compose file was given by hand, else the one its container runs as (an
# upgrade never renames it); else, for a new one, its directory's.
choose_collector_container_name() {
    local edited="" id="" running=""
    edited="$(compose_container_name "$INSTALL_DIR/$COMPOSE_FILE_NAME")"
    if [ -n "$edited" ] && [ "$edited" != "$DEFAULT_CONTAINER_NAME" ]; then
        printf '%s' "$edited"
        return 0
    fi
    if [ -f "$INSTALL_DIR/$COMPOSE_FILE_NAME" ]; then
        id="$(cd "$INSTALL_DIR" 2>/dev/null && docker compose -f "$COMPOSE_FILE_NAME" ps -a -q "$AGENT_SERVICE" 2>/dev/null | head -n 1)" || true
        if [ -n "$id" ]; then
            running="$(docker inspect -f '{{.Name}}' "$id" 2>/dev/null | head -n 1)" || true
            running="${running#/}"
        fi
    fi
    if is_container_name "$running"; then
        printf '%s' "$running"
    else
        directory_container_name
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
AGENT_FILES_ON_GITHUB="https://raw.githubusercontent.com/OneUptime/oneuptime/main/agents/OpenStackAgent"
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

SCRIPT_NAME="install-traces.sh"
if [ "$PROFILE" = "docker" ]; then
    # The collector's container name (see "The collector's container name" above), and the
    # directory, before anything is written or stopped.
    if [ -n "$OPENSTACK_TRACES_CONTAINER_NAME" ]; then
        if ! is_container_name "$OPENSTACK_TRACES_CONTAINER_NAME"; then
            echo "Error: OPENSTACK_TRACES_CONTAINER_NAME=\"$OPENSTACK_TRACES_CONTAINER_NAME\" is not a container name: a letter or a digit,"
            echo "then letters, digits, _, . or - (e.g. $DEFAULT_CONTAINER_NAME-2). Nothing was installed or changed."
            exit 1
        fi
    else
        OPENSTACK_TRACES_CONTAINER_NAME="$(choose_collector_container_name)"
    fi
    OTHER_PROJECT_DIR="$(other_project_directory)"
    if [ -n "$OTHER_PROJECT_DIR" ]; then
        echo "Error: $OTHER_PROJECT_DIR already runs containers in the Docker Compose project"
        echo "\"$(compose_project_name)\": Compose names a project after its directory, and gives $INSTALL_DIR"
        echo "that name too. Installing here would recreate them and run this collector in their place. Install"
        echo "it into a directory of another name instead, e.g. INSTALL_DIR=$(absolute_install_dir)-2 bash $SCRIPT_NAME"
        exit 1
    fi
fi

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
        printf 'OPENSTACK_TRACES_CONTAINER_NAME=%s\n' "$(compose_env_quote "$OPENSTACK_TRACES_CONTAINER_NAME")"
    } > "$ENV_FILE"
    chmod 600 "$ENV_FILE"

    cd "$INSTALL_DIR"
    if ! docker compose -f docker-compose.traces.yml pull; then
        echo "Warning: could not pull the image; starting with the one this machine has."
    fi
    # --force-recreate: the collector reads its config only when it starts, and Compose
    # recreates a container for a changed definition, never for a changed bind mount.
    if ! docker compose -f docker-compose.traces.yml up -d --force-recreate; then
        echo ""
        echo "Error: it did not start. If Docker reports that the container name \"$OPENSTACK_TRACES_CONTAINER_NAME\" is"
        echo "already in use, another container on this machine has it: give this one a name of its own and"
        echo "run this again, e.g. OPENSTACK_TRACES_CONTAINER_NAME=$DEFAULT_CONTAINER_NAME-2 INSTALL_DIR=$INSTALL_DIR bash install-traces.sh"
        echo "It is kept in $ENV_FILE from then on."
        exit 1
    fi

    LISTENS_ON="${OPENSTACK_TRACES_PUBLISH_ADDRESS:-127.0.0.1}:4318"
    STATUS_COMMAND="cd $INSTALL_DIR && docker compose -f docker-compose.traces.yml ps"
    LOG_COMMAND="docker logs -f $OPENSTACK_TRACES_CONTAINER_NAME"
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
echo "(pip install 'opentelemetry-sdk<1.44' 'opentelemetry-exporter-otlp<1.44'), and this in its config,"
echo "with a key of your own, the same on every service:"
echo ""
echo "  [profiler]"
echo "  enabled = True"
echo "  hmac_keys = <your key>"
echo "  connection_string = otlp://$LISTENS_ON"
echo "  trace_sqlalchemy = False"
echo ""
echo "Leave Placement out for now: as OpenStack ships it, the driver cannot start there."
echo "Then open this cloud's Traces page in OneUptime: it gives the command that signs a request,"
echo "and says what a trace shows and what it cannot."
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
