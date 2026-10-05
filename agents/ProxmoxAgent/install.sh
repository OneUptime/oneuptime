#!/bin/bash
set -e

echo "=========================================="
echo "  OneUptime Proxmox Agent Installer"
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

# Prompt for configuration
if [ -z "$ONEUPTIME_URL" ]; then
    read -rp "OneUptime URL (e.g., https://oneuptime.com): " ONEUPTIME_URL
fi

if [ -z "$ONEUPTIME_TELEMETRY_INGESTION_KEY" ]; then
    read -rp "OneUptime Telemetry Ingestion Key: " ONEUPTIME_TELEMETRY_INGESTION_KEY
fi

if [ -z "$PROXMOX_CLUSTER_NAME" ]; then
    read -rp "Proxmox cluster name (shown in OneUptime, keep it stable) [proxmox-cluster]: " PROXMOX_CLUSTER_NAME
    PROXMOX_CLUSTER_NAME="${PROXMOX_CLUSTER_NAME:-proxmox-cluster}"
fi

if [ -z "$PVE_HOST" ]; then
    read -rp "Proxmox VE API host (any node; the exporter and the AI agent query it, e.g., 192.168.1.10): " PVE_HOST
fi

# Decide whether to run the bundled prometheus-pve-exporter
COMPOSE_PROFILES=""
if [ -z "$PVE_EXPORTER_URL" ]; then
    read -rp "Run the bundled prometheus-pve-exporter? [Y/n]: " RUN_EXPORTER
    RUN_EXPORTER="${RUN_EXPORTER:-Y}"
    if [[ "$RUN_EXPORTER" =~ ^[Yy] ]]; then
        COMPOSE_PROFILES="pve-exporter"
        PVE_EXPORTER_URL="pve-exporter:9221"
        if [ -z "$PVE_API_TOKEN_ID" ]; then
            read -rp "Proxmox API token id (user@realm!tokenname): " PVE_API_TOKEN_ID
        fi
        if [ -z "$PVE_API_TOKEN_SECRET" ]; then
            read -rp "Proxmox API token secret: " PVE_API_TOKEN_SECRET
        fi
    else
        # No localhost default here: the agent runs as a container on the
        # compose bridge network, so "localhost" inside it is the agent
        # itself — it can never reach an exporter running on this host.
        # Use an address reachable from containers: the host's LAN IP or
        # DNS name (or host.docker.internal on Docker Desktop).
        echo "Note: the agent runs in a container, so 'localhost' cannot reach an"
        echo "exporter on this host — use the host's LAN IP or DNS name instead."
        while [ -z "$PVE_EXPORTER_URL" ]; do
            read -rp "Address of your existing pve-exporter (host:port, e.g. 192.168.1.10:9221): " PVE_EXPORTER_URL
        done
    fi
fi

# ----------------------------------------------------------------------------
# OneUptime AI agent (the oneuptime-proxmox-ai-agent service)
# ----------------------------------------------------------------------------
# It runs next to the collector and lets OneUptime AI read this cluster
# through the Proxmox VE API while it investigates an incident or alert, with
# a Proxmox API token from the .env: the collector's PVEAuditor token
# (PVE_API_TOKEN_ID) unless it is given one of its own. Fixes (starting,
# rebooting or shutting down guests, restarting PVE services) are off unless
# ONEUPTIME_AI_ALLOW_WRITES=true, and then need a token that may do them.
echo ""
echo "The OneUptime AI agent lets OneUptime AI read this cluster through the"
echo "Proxmox VE API (read-only) while it investigates incidents and alerts."
if [ -z "$PVE_API_TOKEN_ID" ] && [ -z "$ONEUPTIME_AI_PVE_API_TOKEN_ID" ]; then
    echo "It needs a Proxmox API token with the PVEAuditor role on / (see README.md)."
    read -rp "Proxmox API token id for the AI agent (user@realm!tokenname, empty to skip): " PVE_API_TOKEN_ID
    if [ -n "$PVE_API_TOKEN_ID" ] && [ -z "$PVE_API_TOKEN_SECRET" ]; then
        read -rsp "Proxmox API token secret: " PVE_API_TOKEN_SECRET
        echo ""
    fi
fi

if [ -z "$ONEUPTIME_AI_ALLOW_WRITES" ]; then
    read -rp "Also let it apply fixes (start, reboot or shut down guests; restart PVE services)? [y/N]: " AI_FIXES
    if [[ "$AI_FIXES" =~ ^[Yy] ]]; then
        ONEUPTIME_AI_ALLOW_WRITES="true"
    fi
fi

# Only "true" allows fixes; anything else (unset, a typo) keeps the agent read-only.
if [ "$(printf '%s' "$ONEUPTIME_AI_ALLOW_WRITES" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
    ONEUPTIME_AI_ALLOW_WRITES="true"
else
    ONEUPTIME_AI_ALLOW_WRITES="false"
fi

if [ "$ONEUPTIME_AI_ALLOW_WRITES" = "true" ]; then
    if [ -z "$ONEUPTIME_AI_PVE_API_TOKEN_ID" ]; then
        echo "Fixes need a token of the AI agent's own that may power guests on and off"
        echo "(VM.PowerMgmt: the PVEVMUser role on /vms, see README.md). Leave it empty to"
        echo "use the read-only token above; Proxmox then refuses every fix."
        read -rp "Proxmox API token id for fixes (user@realm!tokenname): " ONEUPTIME_AI_PVE_API_TOKEN_ID
    fi
    if [ -n "$ONEUPTIME_AI_PVE_API_TOKEN_ID" ] && [ -z "$ONEUPTIME_AI_PVE_API_TOKEN_SECRET" ]; then
        read -rsp "Secret of that token: " ONEUPTIME_AI_PVE_API_TOKEN_SECRET
        echo ""
    fi
    if [ -z "$ONEUPTIME_AI_PROTECTED_TARGETS" ]; then
        echo "Guests (VMIDs) OneUptime AI must never change, comma-separated: at least"
        echo "the VM this agent runs in, if it runs on this cluster."
        read -rp "Protected VMIDs [none]: " ONEUPTIME_AI_PROTECTED_TARGETS
    fi
fi

# Create installation directory
INSTALL_DIR="${INSTALL_DIR:-/opt/oneuptime-proxmox-agent}"
echo ""
echo "Installing to: $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"

# Download configuration files
REPO_BASE="https://raw.githubusercontent.com/OneUptime/oneuptime/master/agents/ProxmoxAgent"

echo "Downloading configuration files..."
curl -fsSL "$REPO_BASE/docker-compose.yml" -o "$INSTALL_DIR/docker-compose.yml"
curl -fsSL "$REPO_BASE/otel-collector-config.yaml" -o "$INSTALL_DIR/otel-collector-config.yaml"

# Create .env file
cat > "$INSTALL_DIR/.env" <<EOF
ONEUPTIME_URL=$ONEUPTIME_URL
ONEUPTIME_TELEMETRY_INGESTION_KEY=$ONEUPTIME_TELEMETRY_INGESTION_KEY
PROXMOX_CLUSTER_NAME=$PROXMOX_CLUSTER_NAME
PVE_HOST=$PVE_HOST
PVE_EXPORTER_URL=$PVE_EXPORTER_URL
PVE_API_TOKEN_ID=$PVE_API_TOKEN_ID
PVE_API_TOKEN_SECRET=$PVE_API_TOKEN_SECRET
COMPOSE_PROFILES=$COMPOSE_PROFILES
ONEUPTIME_AI_INVESTIGATION=${ONEUPTIME_AI_INVESTIGATION:-}
ONEUPTIME_AI_FIXES=${ONEUPTIME_AI_FIXES:-}
ONEUPTIME_AI_ALLOW_WRITES=$ONEUPTIME_AI_ALLOW_WRITES
ONEUPTIME_AI_PVE_API_TOKEN_ID=$ONEUPTIME_AI_PVE_API_TOKEN_ID
ONEUPTIME_AI_PVE_API_TOKEN_SECRET=$ONEUPTIME_AI_PVE_API_TOKEN_SECRET
ONEUPTIME_AI_WRITE_TARGETS=$ONEUPTIME_AI_WRITE_TARGETS
ONEUPTIME_AI_PROTECTED_TARGETS=$ONEUPTIME_AI_PROTECTED_TARGETS
EOF
chmod 600 "$INSTALL_DIR/.env"

# Start the agent
echo ""
echo "Starting OneUptime Proxmox Agent..."
cd "$INSTALL_DIR"
docker compose up -d

echo ""
echo "=========================================="
echo "  OneUptime Proxmox Agent is running!"
echo "=========================================="
echo ""
if [ -z "$PVE_API_TOKEN_ID" ] && [ -z "$ONEUPTIME_AI_PVE_API_TOKEN_ID" ]; then
    echo "The OneUptime AI agent (oneuptime-proxmox-ai-agent) has no Proxmox API token, so it"
    echo "cannot run anything. Set PVE_API_TOKEN_ID and PVE_API_TOKEN_SECRET in $INSTALL_DIR/.env and"
    echo "run: docker compose up -d"
elif [ "$ONEUPTIME_AI_ALLOW_WRITES" = "true" ]; then
    echo "The OneUptime AI agent (oneuptime-proxmox-ai-agent) may apply fixes. ONEUPTIME_AI_FIXES"
    echo "in $INSTALL_DIR/.env (ask-for-approval, automatic or bypass-approval) sets whether a"
    echo "person approves each one."
else
    echo "The OneUptime AI agent (oneuptime-proxmox-ai-agent) is read-only. To let it apply"
    echo "fixes, see \"OneUptime AI agent\" in README.md."
fi
echo ""
echo "To check status:  cd $INSTALL_DIR && docker compose ps"
echo "To view logs:     cd $INSTALL_DIR && docker compose logs -f"
echo "AI agent status:  docker exec oneuptime-proxmox-ai-agent wget -qO- http://127.0.0.1:3877/status"
echo "To stop:          cd $INSTALL_DIR && docker compose down"
echo "To restart:       cd $INSTALL_DIR && docker compose restart"
