#!/bin/bash
set -e

# Installs the OneUptime Host AI agent on this Linux host: a container
# (oneuptime/resource-ai-agent) that runs the host's own diagnostic programs
# for OneUptime AI — read-only unless ONEUPTIME_AI_ALLOW_WRITES=true.
#
#   curl -fsSL https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/HostAIAgent/install.sh | sudo bash
#
# Settings come from the environment, or are asked for:
#   ONEUPTIME_URL                      your OneUptime address
#   ONEUPTIME_TELEMETRY_INGESTION_KEY  the project's telemetry ingestion key
#   HOST_NAME                          the host.name your collector reports
#                                      (empty: this host's hostname)
#   ONEUPTIME_AI_ALLOW_WRITES          "true" to allow fixes (default false)
#   ONEUPTIME_AI_WRITE_TARGETS         unit globs fixes may touch (default any)
#   ONEUPTIME_AI_PROTECTED_TARGETS     unit globs never to change
#   INSTALL_DIR                        default /opt/oneuptime-host-ai-agent
#
# --systemd  run it under the oneuptime-host-ai-agent systemd unit instead
#            of starting it with `docker compose up -d`.

USE_SYSTEMD=false
for arg in "$@"; do
    case "$arg" in
        --systemd) USE_SYSTEMD=true ;;
        -h|--help)
            sed -n '4,21p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//'
            exit 0
            ;;
        *)
            echo "Unknown option: $arg (the only option is --systemd)"
            exit 1
            ;;
    esac
done

echo "=========================================="
echo "  OneUptime Host AI Agent Installer"
echo "=========================================="
echo ""

# The agent enters the host's namespaces with nsenter: Linux only.
if [ "$(uname -s)" != "Linux" ]; then
    echo "Error: the Host AI agent runs on Linux hosts only (this is $(uname -s))."
    exit 1
fi

if [ "$(id -u)" -ne 0 ]; then
    echo "Error: run this installer as root (e.g. with sudo): it writes to /opt and"
    echo "starts a privileged container."
    exit 1
fi

# Check prerequisites
if ! command -v docker &> /dev/null; then
    if command -v podman &> /dev/null; then
        echo "Error: Docker is not installed, but Podman is. This installer uses Docker;"
        echo "to run the agent with Podman, follow the Podman section of the README:"
        echo "https://github.com/OneUptime/oneuptime/tree/master/agents/HostAIAgent#podman"
    else
        echo "Error: Docker is not installed. Please install Docker first."
    fi
    exit 1
fi

if ! docker info &> /dev/null 2>&1; then
    echo "Error: Docker daemon is not running or you don't have permission to access it."
    exit 1
fi

if ! docker compose version &> /dev/null 2>&1; then
    echo "Error: Docker Compose v2 is not available. Please install the docker compose plugin."
    exit 1
fi

# Rootless Docker cannot enter the host's namespaces.
if docker info --format '{{json .SecurityOptions}}' 2>/dev/null | grep -q rootless; then
    echo "Error: this Docker engine is rootless, and a rootless container cannot enter the"
    echo "host's namespaces. Install the agent with the system (rootful) Docker engine."
    exit 1
fi

# A value for .env, quoted so Compose reads it back exactly: single quotes
# are literal; a value holding a single quote or ending in a backslash is
# double-quoted with \ " and $ escaped.
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

# Ask for a setting on the terminal, even when this script itself arrives on
# stdin (curl ... | sudo bash): ask NAME "prompt".
ask() {
    local __name="$1" __prompt="$2" __answer=""
    if [ -t 0 ]; then
        read -rp "$__prompt" __answer || true
    elif ( : < /dev/tty ) 2> /dev/null; then
        read -rp "$__prompt" __answer < /dev/tty || true
    else
        echo "Error: $__name is not set, and there is no terminal to ask for it."
        echo "Set it in the environment and run the installer again."
        exit 1
    fi
    printf -v "$__name" '%s' "$__answer"
}

# Prompt for configuration
if [ -z "$ONEUPTIME_URL" ]; then
    ask ONEUPTIME_URL "OneUptime URL (e.g., https://oneuptime.com): "
fi

if [ -z "$ONEUPTIME_TELEMETRY_INGESTION_KEY" ] && [ -z "$ONEUPTIME_API_KEY" ]; then
    ask ONEUPTIME_TELEMETRY_INGESTION_KEY "OneUptime Telemetry Ingestion Key: "
fi

if [ -z "$ONEUPTIME_URL" ]; then
    echo "Error: ONEUPTIME_URL is required."
    exit 1
fi

if [ -z "$ONEUPTIME_TELEMETRY_INGESTION_KEY" ] && [ -z "$ONEUPTIME_API_KEY" ]; then
    echo "Error: a telemetry ingestion key is required (ONEUPTIME_TELEMETRY_INGESTION_KEY)."
    exit 1
fi

# The name must be the host.name the OpenTelemetry collector reports for
# this host, or the agent serves a Host the collector never created.
THIS_HOSTNAME="$(hostname 2>/dev/null || uname -n)"
if [ -z "${HOST_NAME+x}" ]; then
    echo ""
    echo "The agent must use the same name as the host.name your OpenTelemetry collector"
    echo "reports for this host (the name shown under Hosts in OneUptime). Collectors report"
    echo "the hostname ($THIS_HOSTNAME) unless you set host.name yourself."
    ask HOST_NAME "Host name [leave empty to use the hostname, $THIS_HOSTNAME]: "
fi

ONEUPTIME_AI_ALLOW_WRITES="${ONEUPTIME_AI_ALLOW_WRITES:-false}"
case "$ONEUPTIME_AI_ALLOW_WRITES" in
    true|false) ;;
    *)
        echo "Error: ONEUPTIME_AI_ALLOW_WRITES must be true or false (got '$ONEUPTIME_AI_ALLOW_WRITES')."
        exit 1
        ;;
esac

for name in ONEUPTIME_URL ONEUPTIME_API_KEY ONEUPTIME_TELEMETRY_INGESTION_KEY HOST_NAME ONEUPTIME_AI_WRITE_TARGETS ONEUPTIME_AI_PROTECTED_TARGETS; do
    case "${!name}" in
        *$'\n'*|*$'\r'*)
            echo "Error: $name must be a single line."
            exit 1
            ;;
    esac
done

# Create installation directory
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-host-ai-agent}"
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR/systemd"

# Download configuration files
REPO_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/HostAIAgent"

echo "Downloading configuration files..."
curl -fsSL "$REPO_BASE/docker-compose.yml" -o "$INSTALL_DIR/docker-compose.yml"
curl -fsSL "$REPO_BASE/systemd/oneuptime-host-ai-agent.service" -o "$INSTALL_DIR/systemd/oneuptime-host-ai-agent.service"

# Create .env file. It holds the ingestion key, so it is made owner-only
# before anything is written to it.
ENV_FILE="$INSTALL_DIR/.env"
touch "$ENV_FILE"
chmod 600 "$ENV_FILE"
cat > "$ENV_FILE" <<EOF
ONEUPTIME_URL=$(compose_env_quote "$ONEUPTIME_URL")
ONEUPTIME_API_KEY=$(compose_env_quote "${ONEUPTIME_API_KEY:-}")
ONEUPTIME_TELEMETRY_INGESTION_KEY=$(compose_env_quote "${ONEUPTIME_TELEMETRY_INGESTION_KEY:-}")
HOST_NAME=$(compose_env_quote "${HOST_NAME:-}")
ONEUPTIME_AI_ALLOW_WRITES=$ONEUPTIME_AI_ALLOW_WRITES
ONEUPTIME_AI_WRITE_TARGETS=$(compose_env_quote "${ONEUPTIME_AI_WRITE_TARGETS:-}")
ONEUPTIME_AI_PROTECTED_TARGETS=$(compose_env_quote "${ONEUPTIME_AI_PROTECTED_TARGETS:-}")
EOF
chmod 600 "$ENV_FILE"

ENV_NAMES="ONEUPTIME_URL ONEUPTIME_API_KEY ONEUPTIME_TELEMETRY_INGESTION_KEY HOST_NAME \
ONEUPTIME_AI_ALLOW_WRITES ONEUPTIME_AI_WRITE_TARGETS ONEUPTIME_AI_PROTECTED_TARGETS"

echo ""
echo "Starting the OneUptime Host AI agent (writes allowed: $ONEUPTIME_AI_ALLOW_WRITES)..."
cd "$INSTALL_DIR"

if [ "$USE_SYSTEMD" = "true" ]; then
    if ! command -v systemctl &> /dev/null; then
        echo "Error: --systemd needs systemd (systemctl was not found)."
        exit 1
    fi
    # A container started earlier with `docker compose up -d` gives way to the unit.
    docker compose down --remove-orphans &> /dev/null || true
    sed "s#^WorkingDirectory=.*#WorkingDirectory=$INSTALL_DIR#" \
        "$INSTALL_DIR/systemd/oneuptime-host-ai-agent.service" \
        > /etc/systemd/system/oneuptime-host-ai-agent.service
    systemctl daemon-reload
    systemctl enable oneuptime-host-ai-agent.service
    systemctl restart oneuptime-host-ai-agent.service
else
    # Compose gives variables in its environment precedence over .env; start
    # from .env alone, so this start runs exactly what every later
    # `docker compose up` will. --force-recreate, because a re-run is the
    # upgrade path.
    (
        for name in $ENV_NAMES; do
            unset "$name"
        done
        docker compose pull
        docker compose up -d --force-recreate
    )
fi

echo ""
echo "=========================================="
echo "  OneUptime Host AI agent is running!"
echo "=========================================="
echo ""
if [ "$USE_SYSTEMD" = "true" ]; then
    echo "To check status:  systemctl status oneuptime-host-ai-agent"
    echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
    echo "To stop:          systemctl stop oneuptime-host-ai-agent"
else
    echo "To check status:  cd $INSTALL_DIR && docker compose ps"
    echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
    echo "To stop:          cd $INSTALL_DIR && docker compose down"
fi
echo "Agent status:     curl -s http://127.0.0.1:3877/status"
echo ""
if [ -n "${HOST_NAME:-}" ]; then
    echo "It serves the Host \"$HOST_NAME\" in OneUptime (HOST_NAME)."
else
    echo "It serves the Host \"$THIS_HOSTNAME\" in OneUptime (this host's hostname)."
fi
if [ "$ONEUPTIME_AI_ALLOW_WRITES" = "true" ]; then
    echo "It may apply the fixes you allow on the host's AI agent page in OneUptime"
    echo "(never to itself or the collector)."
else
    echo "It is read-only: OneUptime AI can look at this host while it investigates, but"
    echo "not change it. To let it apply fixes (restart a unit, signal a process), set"
    echo "ONEUPTIME_AI_ALLOW_WRITES=true in $ENV_FILE (and ONEUPTIME_AI_WRITE_TARGETS to"
    echo "limit which units), run 'docker compose up -d' in $INSTALL_DIR, then choose on"
    echo "the host's AI agent page whether each fix needs approval."
fi
